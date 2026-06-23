// src/app/api/ic/route.js — Inter-Company Transactions API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

const MIN_FEE_MGT  = 0.05; // 5% minimum management fee
const MIN_FEE_LIC  = 0.03; // 3% minimum accreditation licence fee

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'transactions';

  try {
    switch (section) {
      case 'transactions': {
        const rows = await query(
          `SELECT ic.*, rp.name as entity_name, rp.type as entity_type
           FROM ic_transactions ic LEFT JOIN related_parties rp ON ic.entity_id=rp.id
           ORDER BY ic.created_at DESC`
        );
        const [totals] = await query(
          `SELECT SUM(fee_amount) as total_fees, SUM(collected) as total_collected,
                  SUM(fee_amount-collected) as outstanding, COUNT(*) as count
           FROM ic_transactions`
        );
        return ok({ totals, transactions: rows });
      }

      case 'entities':
        return ok(await query(`SELECT * FROM related_parties WHERE status='active' ORDER BY name`));

      case 'summary': {
        const rows = await query(
          `SELECT rp.name, ic.type, SUM(ic.contract_value) as total_contracts,
                  SUM(ic.fee_amount) as total_fees, SUM(ic.collected) as total_collected
           FROM ic_transactions ic JOIN related_parties rp ON ic.entity_id=rp.id
           GROUP BY rp.id, ic.type ORDER BY total_fees DESC`
        );
        return ok(rows);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {
      case 'create_transaction': {
        const { entity_id, type, contract_value, fee_pct, icsa_verified, notes } = body;
        if (!entity_id || !type || !contract_value) return err('entity_id, type, contract_value required', 400);

        // ICM-002/003: Enforce minimum fee rates
        const minPct  = type === 'management_fee' ? MIN_FEE_MGT : MIN_FEE_LIC;
        const actualPct = parseFloat(fee_pct) / 100;
        if (actualPct < minPct) {
          return err(`ICM-002/003: Fee below minimum. ${type === 'management_fee' ? 'Management fee minimum is 5%' : 'Accreditation licence fee minimum is 3%'}. Entered: ${(actualPct*100).toFixed(1)}%`, 400);
        }

        // ICM-002: No transaction without ICSA
        if (!icsa_verified) return err('ICM-002: No inter-company transaction can be processed without a signed ICSA on file. Please upload and verify the ICSA first.', 400);

        const fee_amount = Math.round(parseFloat(contract_value) * actualPct);
        const id = uuid();

        await run(
          `INSERT INTO ic_transactions (id,entity_id,type,contract_value,fee_amount,fee_pct,min_fee_pct,icsa_verified,notes,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, entity_id, type, contract_value, fee_amount, actualPct, minPct, 1, notes, auth.user.employee_id]
        );

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_IC_TRANSACTION', module: 'InterCompany', recordId: id, newValue: { entity_id, type, contract_value, fee_amount, fee_pct: actualPct } });

        // FIN-005: auto-generate the matching GL journal for the inter-company
        // fee — Dr Inter-company receivable, Cr Inter-company income — posted
        // and tagged to this transaction. Uses the dedicated COA account types.
        let journal_no = null;
        try {
          const recv = await queryOne(`SELECT id FROM chart_of_accounts WHERE type='ic_receivable' AND is_active=1 LIMIT 1`);
          const inc  = await queryOne(`SELECT id FROM chart_of_accounts WHERE type='ic_income' AND is_active=1 LIMIT 1`);
          if (recv && inc) {
            const jid = uuid(); journal_no = `JV-IC-${Date.now()}`;
            await transaction(async ({ run: dbRun }) => {
              await dbRun(`INSERT INTO journal_entries (id,entry_no,date,description,reference,module,module_ref,prepared_by,approved_by,approved_at,status)
                           VALUES (?,?,?,?,?, 'InterCompany', ?, ?, ?, datetime('now'), 'posted')`,
                [jid, journal_no, new Date().toISOString().split('T')[0], `Inter-company ${type.replace('_',' ')} fee`, id, id, auth.user.employee_id, auth.user.employee_id]);
              await dbRun(`INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit) VALUES (?,?,?,?,?,0)`,
                [uuid(), jid, recv.id, 'Inter-company receivable', fee_amount]);
              await dbRun(`INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit) VALUES (?,?,?,?,0,?)`,
                [uuid(), jid, inc.id, 'Inter-company fee income', fee_amount]);
            });
          }
        } catch (e) { console.error('[IC journal]', e.message); }

        return ok({ id, fee_amount, fee_pct: actualPct, journal_no }, 201);
      }

      case 'record_collection': {
        const { transaction_id, amount } = body;
        if (!transaction_id || !amount) return err('transaction_id and amount required', 400);
        const tx = await queryOne(`SELECT * FROM ic_transactions WHERE id=?`, [transaction_id]);
        if (!tx) return err('Transaction not found', 404);
        const new_collected = Math.min(tx.fee_amount, tx.collected + amount);
        const new_status    = new_collected >= tx.fee_amount ? 'settled' : 'partial';
        await run(`UPDATE ic_transactions SET collected=?, status=? WHERE id=?`, [new_collected, new_status, transaction_id]);
        return ok({ collected: new_collected, status: new_status });
      }

      case 'add_entity': {
        const { name, type, icsa_ref, contact } = body;
        if (!name || !type) return err('name and type required', 400);
        const id = uuid();
        await run(`INSERT INTO related_parties (id,name,type,icsa_ref,contact,status) VALUES (?,?,?,?,?,'active')`,
          [id, name, type, icsa_ref, contact]);
        return ok({ id }, 201);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[IC POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
