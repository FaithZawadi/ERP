// src/lib/scheduler.js — Automated Job Scheduler (node-cron)
// Handles: imprest overdue conversion, compliance alerts, DB backup, statutory reminders
// Start with: node src/lib/scheduler.js (or import in server startup)

const cron = require('node-cron');
const path = require('path');
const fs   = require('fs');

// ── HELPERS ───────────────────────────────────────────────────────────────────

function log(job, msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const line = `[${ts}] [SCHEDULER] [${job}] [${level}] ${msg}`;
  console.log(line);
  // Append to log file
  const logDir  = path.join(process.cwd(), 'logs');
  const logFile = path.join(logDir, `scheduler-${new Date().toISOString().slice(0,10)}.log`);
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  } catch {}
}

async function getDB() {
  const db = require('./db');
  return db;
}

// ── JOB 1: IMPREST OVERDUE CONVERSION (daily 00:01) ─────────────────────────
// QSL-FIN-CHP-001: Any imprest not accounted within 14 days auto-converts

async function runImprestOverdue() {
  log('IMPREST_OVERDUE', 'Starting daily imprest overdue check...');
  try {
    const db    = await getDB();
    const today = new Date().toISOString().split('T')[0];

    const overdue = await db.query(
      `SELECT i.*, e.first_name||' '||e.last_name as employee_name, e.email
       FROM imprest i JOIN employees e ON i.employee_id=e.id
       WHERE i.due_date < ? AND i.status='pending'`, [today]
    );

    if (overdue.length === 0) {
      log('IMPREST_OVERDUE', 'No overdue imprest found.');
      return;
    }

    log('IMPREST_OVERDUE', `Found ${overdue.length} overdue imprest records.`);

    for (const imp of overdue) {
      await db.run(
        `UPDATE imprest SET status='OVERDUE', converted_to_advance=1, converted_at=datetime('now') WHERE id=?`,
        [imp.id]
      );
      log('IMPREST_OVERDUE', `Converted: ${imp.ref_no} — ${imp.employee_name} — Kshs ${imp.amount}`);
    }

    // Alert Finance Manager
    try {
      const { sendImprestOverdueAlert } = require('./email');
      const fm = await db.queryOne(
        `SELECT e.email FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='cfo' AND e.status='active' LIMIT 1`
      );
      if (fm?.email) {
        await sendImprestOverdueAlert(overdue, fm.email);
        log('IMPREST_OVERDUE', `Alert sent to FM: ${fm.email}`);
      }
    } catch (emailErr) {
      log('IMPREST_OVERDUE', `Email alert failed: ${emailErr.message}`, 'WARN');
    }

    log('IMPREST_OVERDUE', `Completed. ${overdue.length} records converted.`);
  } catch (err) {
    log('IMPREST_OVERDUE', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 2: COMPLIANCE EXPIRY ALERTS (daily 08:00) ────────────────────────────
// Alert responsible person when certificates expire within 60 / 30 / 7 days

async function runComplianceAlerts() {
  log('COMPLIANCE_ALERTS', 'Starting compliance expiry check...');
  try {
    const db = await getDB();

    const expiring = await db.query(
      `SELECT cd.*, e.first_name||' '||e.last_name as responsible_name, e.email as responsible_email
       FROM compliance_docs cd
       LEFT JOIN employees e ON cd.responsible=e.id
       WHERE cd.expires_at <= date('now','+60 days')
         AND cd.expires_at >= date('now')
         AND cd.status='current'
       ORDER BY cd.expires_at`
    );

    if (expiring.length === 0) {
      log('COMPLIANCE_ALERTS', 'No documents expiring within 60 days.');
      return;
    }

    log('COMPLIANCE_ALERTS', `Found ${expiring.length} expiring documents.`);

    // Group by responsible person
    const byPerson = expiring.reduce((acc, doc) => {
      const key = doc.responsible_email || 'admin';
      if (!acc[key]) acc[key] = { email: key, name: doc.responsible_name, docs: [] };
      acc[key].docs.push(doc);
      return acc;
    }, {});

    try {
      const { sendComplianceAlert } = require('./email');
      for (const [email, { docs, name }] of Object.entries(byPerson)) {
        if (email !== 'admin' && email.includes('@')) {
          await sendComplianceAlert(docs, email);
          log('COMPLIANCE_ALERTS', `Alert sent to ${name} <${email}>: ${docs.length} doc(s)`);
        }
      }
      // Always alert ICT Head / admin
      const ict = await db.queryOne(`SELECT e.email FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='admin' LIMIT 1`);
      if (ict?.email) {
        await sendComplianceAlert(expiring, ict.email);
        log('COMPLIANCE_ALERTS', `Summary sent to ICT: ${ict.email}`);
      }
    } catch (emailErr) {
      log('COMPLIANCE_ALERTS', `Email failed: ${emailErr.message}`, 'WARN');
    }

    log('COMPLIANCE_ALERTS', 'Completed.');
  } catch (err) {
    log('COMPLIANCE_ALERTS', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 3: STATUTORY DEADLINE REMINDERS (monthly, 5th of month) ──────────────
// Remind Finance Manager of upcoming KRA / statutory deadlines

async function runStatutoryReminders() {
  log('STATUTORY', 'Sending statutory deadline reminders...');
  try {
    const { STATUTORY_OBLIGATIONS, getNextDueDate } = require('./tax');
    const { sendApprovalRequest } = require('./email');
    const db = await getDB();

    const fm = await db.queryOne(
      `SELECT e.email, e.first_name||' '||e.last_name as name
       FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='cfo' AND e.status='active' LIMIT 1`
    );
    if (!fm?.email) { log('STATUTORY', 'No FM found for reminder.', 'WARN'); return; }

    const upcoming = STATUTORY_OBLIGATIONS
      .map(o => ({ ...o, next_due: getNextDueDate(o) }))
      .filter(o => {
        if (!o.next_due) return false;
        const days = Math.round((new Date(o.next_due) - new Date()) / 86400000);
        return days >= 0 && days <= 10;
      });

    if (upcoming.length === 0) { log('STATUTORY', 'No obligations due within 10 days.'); return; }

    const list = upcoming.map(o => `• ${o.name} — Due: ${o.next_due} (${o.agency})`).join('\n');
    await sendApprovalRequest({
      to:             fm.email,
      approver_name:  fm.name,
      action:         `${upcoming.length} Statutory Obligation(s) Due Within 10 Days`,
      document_ref:   'Statutory Calendar',
      requested_by:   'QSL ERP Scheduler',
    });

    log('STATUTORY', `Reminder sent for ${upcoming.length} obligation(s) to ${fm.email}`);
  } catch (err) {
    log('STATUTORY', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 4: DATABASE BACKUP (daily 02:00) ─────────────────────────────────────
// Backup SQLite DB to timestamped file; keep last 30 days

async function runDatabaseBackup() {
  log('DB_BACKUP', 'Starting database backup...');
  try {
    const dbPath      = path.join(process.cwd(), 'database', 'qsl_erp.db');
    const backupDir   = path.join(process.cwd(), 'database', 'backups');
    const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath  = path.join(backupDir, `qsl_erp_${timestamp}.db`);

    if (!fs.existsSync(dbPath)) {
      log('DB_BACKUP', 'Database file not found — skipping.', 'WARN');
      return;
    }

    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    fs.copyFileSync(dbPath, backupPath);
    const size = (fs.statSync(backupPath).size / 1024).toFixed(1);
    log('DB_BACKUP', `Backup created: ${path.basename(backupPath)} (${size} KB)`);

    // Prune backups older than 30 days
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('qsl_erp_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(30);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(backupDir, f.name));
      log('DB_BACKUP', `Pruned old backup: ${f.name}`);
    }

    log('DB_BACKUP', `Backup complete. ${files.length - toDelete.length} backups retained.`);
  } catch (err) {
    log('DB_BACKUP', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 5: FLEET INSURANCE / SERVICE ALERTS (weekly Monday 08:00) ────────────

async function runFleetAlerts() {
  log('FLEET_ALERTS', 'Checking fleet insurance and service due dates...');
  try {
    const db = await getDB();

    const vehicles = await db.query(
      `SELECT v.*
       FROM vehicles v
       WHERE (v.insurance_to <= date('now','+30 days') OR v.service_due <= date('now','+14 days'))
         AND v.status='active'`
    );

    if (vehicles.length === 0) { log('FLEET_ALERTS', 'No fleet alerts.'); return; }

    const { sendApprovalRequest } = require('./email');
    const admin = await db.queryOne(
      `SELECT e.email, e.first_name||' '||e.last_name as name FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='admin' LIMIT 1`
    );
    if (admin?.email) {
      const items = vehicles.map(v => `${v.reg_no}: Insurance to ${v.insurance_to || '—'} | Service due ${v.service_due || '—'}`).join('; ');
      await sendApprovalRequest({
        to: admin.email, approver_name: admin.name,
        action: `${vehicles.length} Vehicle(s) Need Attention`,
        document_ref: items, requested_by: 'QSL ERP Fleet Scheduler',
      });
      log('FLEET_ALERTS', `Alert sent for ${vehicles.length} vehicle(s)`);
    }
  } catch (err) {
    log('FLEET_ALERTS', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 6: LEAVE BALANCE RESET (1 Jan each year 00:05) ───────────────────────

async function runLeaveBalanceReset() {
  const year = new Date().getFullYear();
  log('LEAVE_RESET', `Annual leave balance reset for ${year}...`);
  try {
    const db = await getDB();
    await db.run(`UPDATE employees SET leave_balance=21 WHERE status='active' AND employment_type='permanent'`);
    await db.run(`UPDATE employees SET leave_balance=14 WHERE status='active' AND employment_type='contract'`);
    log('LEAVE_RESET', `Leave balances reset for ${year}.`);
  } catch (err) {
    log('LEAVE_RESET', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 7: KPI L&D HOURS BLOCK CHECK (monthly, 1st) ─────────────────────────
// Block salary increment if L&D hours < 40 for the year

async function runLDBlockCheck() {
  log('LD_BLOCK', 'Checking L&D hours for increment block...');
  try {
    const db = await getDB();
    const result = await db.query(
      `UPDATE kpi_scorecards SET increment_blocked=1
       WHERE employee_id IN (
         SELECT id FROM employees WHERE l_and_d_hours < l_and_d_target AND status='active'
       ) AND increment_blocked=0`
    );
    log('LD_BLOCK', 'L&D increment block check complete.');
  } catch (err) {
    log('LD_BLOCK', `ERROR: ${err.message}`, 'ERROR');
  }
}


// ── JOB 8: CLIENT INVOICE OVERDUE REMINDERS (daily 09:00) ────────────────────
// Sends escalating payment reminders to clients with outstanding invoices.
// Days 1-14: Friendly reminder | 15-30: Formal | 31-60: Final demand | 60+: Legal

async function runClientInvoiceReminders() {
  log('CLIENT_REMINDERS', 'Starting client invoice overdue reminder run...');
  try {
    const db      = await getDB();
    const { sendInvoiceReminder } = require('./email');
    const today   = new Date();

    // Get all clients with outstanding balances + their account owner contact
    const clients = await db.query(
      `SELECT c.*,
              e.first_name||' '||e.last_name as owner_name,
              e.email as owner_email,
              e.phone as owner_phone
       FROM clients c
       LEFT JOIN employees e ON c.account_owner=e.id
       WHERE c.outstanding > 0
         AND c.email IS NOT NULL
         AND c.email != ''
         AND c.status = 'active'`
    );

    log('CLIENT_REMINDERS', `Found ${clients.length} client(s) with outstanding balances.`);

    let sent = 0, skipped = 0, errors = 0;

    for (const client of clients) {
      try {
        // Get their unpaid/overdue invoices
        const invoices = await db.query(
          `SELECT ti.*, ti.total as outstanding
           FROM tax_invoices ti
           WHERE ti.client_id=?
             AND ti.status NOT IN ('paid','cancelled','draft')
           ORDER BY ti.date`,
          [client.id]
        );
        // days_overdue computed in JS — julianday()/date(x,'+N days') are
        // SQLite-only, so this keeps the query portable across backends.
        // Effective due date: explicit due_date if set, else invoice date + 30 days.
        const now = Date.now();
        for (const inv of invoices) {
          let effectiveDue;
          if (inv.due_date) {
            effectiveDue = new Date(inv.due_date).getTime();
          } else {
            effectiveDue = new Date(inv.date).getTime() + 30 * 86400000;
          }
          inv.days_overdue = Math.floor((now - effectiveDue) / 86400000);
        }

        // If no formal invoices, use the outstanding balance from clients table
        // (could be manually entered or from legacy data)
        const invoiceList = invoices.length > 0
          ? invoices.filter(i => (i.days_overdue || 0) > 0)
          : [{
              invoice_no:   'Outstanding Balance',
              ref:          `Balance as at ${today.toLocaleDateString('en-KE')}`,
              date:         null,
              due_date:     null,
              outstanding:  client.outstanding,
              days_overdue: 1,
            }];

        if (invoiceList.length === 0) { skipped++; continue; }

        // Calculate max days overdue across all invoices
        const maxDaysOverdue = Math.max(
          ...invoiceList.map(i => Math.floor(i.days_overdue || 1))
        );

        const totalOutstanding = invoices.length > 0
          ? invoiceList.reduce((s, i) => s + (i.outstanding || i.total || 0), 0)
          : client.outstanding;

        const accountOwner = {
          name:  client.owner_name,
          email: client.owner_email,
          phone: client.owner_phone,
        };

        await sendInvoiceReminder(client, invoiceList, maxDaysOverdue, totalOutstanding, accountOwner);

        log('CLIENT_REMINDERS',
          `Sent to ${client.name} <${client.email}> — Kshs ${totalOutstanding.toLocaleString()} | ${maxDaysOverdue} days overdue | ${
            maxDaysOverdue > 60 ? 'LEGAL NOTICE' :
            maxDaysOverdue > 30 ? 'FINAL DEMAND' :
            maxDaysOverdue > 14 ? 'FORMAL NOTICE' : 'FRIENDLY REMINDER'
          }`
        );
        sent++;

        // Small delay between emails to avoid SMTP rate limits
        await new Promise(r => setTimeout(r, 500));

      } catch (clientErr) {
        log('CLIENT_REMINDERS', `ERROR for ${client.name}: ${clientErr.message}`, 'ERROR');
        errors++;
      }
    }

    log('CLIENT_REMINDERS', `Completed. Sent: ${sent} | Skipped (no email/no overdue): ${skipped} | Errors: ${errors}`);

  } catch (err) {
    log('CLIENT_REMINDERS', `FATAL ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 9: CALIBRATION CERTIFICATE EXPIRY REMINDERS (daily 09:30) ────────────
// Sends reminders to clients 60, 30, 14, and 7 days before cert expiry

async function runCalibrationExpiryReminders() {
  log('CAL_EXPIRY', 'Starting calibration certificate expiry reminder run...');
  try {
    const db      = await getDB();
    const { sendCalibrationReminder } = require('./email');

    // Find certs expiring in exactly 60, 30, 14, or 7 days
    const triggerDays = [60, 30, 14, 7];

    for (const days of triggerDays) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      const dateStr = targetDate.toISOString().split('T')[0];

      const certs = await db.query(
        `SELECT cc.*, c.name as client_name, c.email as client_email,
                c.contact_person, c.phone
         FROM calibration_certs cc
         JOIN clients c ON cc.client_id=c.id
         WHERE cc.next_cal_date=?
           AND cc.result='pass'
           AND c.email IS NOT NULL
           AND c.email != ''`,
        [dateStr]
      );

      if (certs.length === 0) continue;

      // Group by client
      const byClient = certs.reduce((acc, cert) => {
        if (!acc[cert.client_id]) {
          acc[cert.client_id] = {
            client: { id: cert.client_id, name: cert.client_name, email: cert.client_email, contact_person: cert.contact_person },
            certs: [],
          };
        }
        acc[cert.client_id].certs.push(cert);
        return acc;
      }, {});

      for (const { client, certs: clientCerts } of Object.values(byClient)) {
        try {
          await sendCalibrationReminder(client, clientCerts, days);
          log('CAL_EXPIRY', `Sent ${days}-day reminder to ${client.name} <${client.email}> — ${clientCerts.length} cert(s)`);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          log('CAL_EXPIRY', `ERROR for ${client.name}: ${e.message}`, 'ERROR');
        }
      }
    }

    log('CAL_EXPIRY', 'Calibration expiry reminder run complete.');
  } catch (err) {
    log('CAL_EXPIRY', `FATAL ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 10: PROJECT PAYMENT REMINDERS (daily 10:00) ───────────────────────────
// Sends reminders to clients with uncollected invoiced amounts on active projects

async function runProjectPaymentReminders() {
  log('PROJ_PAYMENT', 'Starting project payment reminder run...');
  try {
    const db      = await getDB();
    const { sendProjectPaymentReminder } = require('./email');

    // Active projects where invoiced > collected (i.e. there is uncollected revenue)
    const projects = await db.query(
      `SELECT p.*,
              c.name as client_name, c.email as client_email,
              c.contact_person, c.phone as client_phone,
              c.payment_terms,
              e.first_name||' '||e.last_name as owner_name,
              e.email as owner_email,
              e.phone as owner_phone
       FROM projects p
       JOIN clients c ON p.client_id=c.id
       LEFT JOIN employees e ON c.account_owner=e.id
       WHERE p.status IN ('active','overdue')
         AND p.invoiced_total > p.collected_total
         AND c.email IS NOT NULL
         AND c.email != ''`
    );

    log('PROJ_PAYMENT', `Found ${projects.length} project(s) with uncollected invoiced amounts.`);

    for (const project of projects) {
      try {
        const outstanding   = project.invoiced_total - project.collected_total;
        const paymentTerms  = project.payment_terms || 30;

        // Estimate days overdue (we don't have exact invoice dates here, use project end date as proxy)
        // A more precise version would join to tax_invoices
        const daysOverdue = project.status === 'overdue'
          ? Math.round((new Date() - new Date(project.end_date)) / 86400000)
          : Math.max(1, paymentTerms);

        // Only send if genuinely overdue (past payment terms)
        if (daysOverdue < 1) continue;

        const client = {
          name: project.client_name, email: project.client_email,
          contact_person: project.contact_person, phone: project.client_phone,
        };
        const accountOwner = {
          name: project.owner_name, email: project.owner_email, phone: project.owner_phone,
        };

        await sendProjectPaymentReminder(client, project, project.invoiced_total, project.collected_total, accountOwner, daysOverdue);

        log('PROJ_PAYMENT',
          `Sent to ${project.client_name} re: ${project.ref_no} — Kshs ${outstanding.toLocaleString()} outstanding (${daysOverdue}d overdue)`
        );
        await new Promise(r => setTimeout(r, 500));

      } catch (projErr) {
        log('PROJ_PAYMENT', `ERROR for ${project.ref_no}: ${projErr.message}`, 'ERROR');
      }
    }

    log('PROJ_PAYMENT', 'Project payment reminder run complete.');
  } catch (err) {
    log('PROJ_PAYMENT', `FATAL ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 11: DAILY DEBTORS LIST TO MD + FM (daily 08:00) ───────────────────────
// Circulates the full aged debtors list to MD and Finance Manager every morning

async function runDailyDebtorsList() {
  log('DEBTORS_LIST', 'Compiling daily debtors list...');
  try {
    const db = await getDB();
    const { sendDailyDebtorsList } = require('./email');

    const debtors = await db.query(
      `SELECT c.*, e.first_name||' '||e.last_name as account_owner_name
       FROM clients c LEFT JOIN employees e ON c.account_owner=e.id
       WHERE c.outstanding > 0 ORDER BY c.outstanding DESC`
    );
    // days_outstanding computed in JS — see comment on the same pattern
    // in src/app/api/debtors/route.js for why (julianday is SQLite-only).
    const nowMs = Date.now();
    debtors.forEach(d => {
      d.days_outstanding = d.created_at ? Math.floor((nowMs - new Date(d.created_at).getTime()) / 86400000) : null;
    });

    if (debtors.length === 0) { log('DEBTORS_LIST', 'No outstanding debtors today.'); return; }

    const recipients = await db.query(
      `SELECT e.email FROM employees e JOIN users u ON u.employee_id=e.id
       WHERE u.role IN ('md','cfo') AND e.status='active' AND e.email IS NOT NULL`
    );
    const emails = recipients.map(r => r.email).filter(Boolean);
    if (emails.length === 0) { log('DEBTORS_LIST', 'No MD/FM recipients found.', 'WARN'); return; }

    await sendDailyDebtorsList(debtors, emails);
    log('DEBTORS_LIST', `Sent to ${emails.join(', ')} — ${debtors.length} accounts, Kshs ${debtors.reduce((s,d)=>s+(d.outstanding||0),0).toLocaleString()} outstanding`);

    // Initialise today's EOD report record as pending (if it doesn't exist)
    const today = new Date().toISOString().split('T')[0];
    const existing = await db.queryOne(`SELECT id FROM eod_debtor_reports WHERE report_date=?`, [today]);
    if (!existing) {
      const { v4: uuid } = require('uuid');
      await db.run(`INSERT INTO eod_debtor_reports (id, report_date, status) VALUES (?, ?, 'pending')`, [uuid(), today]);
    }
  } catch (err) {
    log('DEBTORS_LIST', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 12: EOD DEBTOR REPORT REMINDER (daily 16:00) ──────────────────────────
// Reminds the FM one hour before the 17:00 deadline if entries are still missing

async function runEODReportReminder() {
  log('EOD_REMINDER', 'Checking EOD debtor report status...');
  try {
    const db    = await getDB();
    const today = new Date().toISOString().split('T')[0];

    const totalDebtors = await db.query(`SELECT id FROM clients WHERE outstanding > 0`);
    if (totalDebtors.length === 0) { log('EOD_REMINDER', 'No debtors today — skipping.'); return; }

    const recorded = await db.query(`SELECT client_id FROM debtor_followups WHERE followup_date=?`, [today]);
    const recordedIds = new Set(recorded.map(r => r.client_id));
    const pending = totalDebtors.filter(d => !recordedIds.has(d.id));

    const report = await db.queryOne(`SELECT * FROM eod_debtor_reports WHERE report_date=?`, [today]);
    if (report?.status === 'submitted') { log('EOD_REMINDER', 'Report already submitted — no reminder needed.'); return; }
    if (pending.length === 0) { log('EOD_REMINDER', 'All debtors recorded — FM just needs to click submit.'); return; }

    const fm = await db.queryOne(
      `SELECT e.email, e.first_name||' '||e.last_name as name FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='cfo' AND e.status='active' LIMIT 1`
    );
    if (!fm?.email) { log('EOD_REMINDER', 'No FM found.', 'WARN'); return; }

    const { sendEODReportReminder } = require('./email');
    await sendEODReportReminder(fm.email, fm.name, pending.length, '5:00 PM');

    if (report) {
      await db.run(`UPDATE eod_debtor_reports SET reminder_sent_at=datetime('now') WHERE id=?`, [report.id]);
    }
    log('EOD_REMINDER', `Reminder sent to ${fm.name} — ${pending.length} account(s) pending`);
  } catch (err) {
    log('EOD_REMINDER', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── JOB 13: EOD DEBTOR REPORT ESCALATION (daily 17:30) ────────────────────────
// If still not submitted 30 minutes after the 17:00 deadline, escalate to MD/CFO

async function runEODReportEscalation() {
  log('EOD_ESCALATION', 'Checking for missed EOD debtor report deadline...');
  try {
    const db    = await getDB();
    const today = new Date().toISOString().split('T')[0];

    const totalDebtors = await db.query(`SELECT id FROM clients WHERE outstanding > 0`);
    if (totalDebtors.length === 0) { log('EOD_ESCALATION', 'No debtors today — skipping.'); return; }

    const report = await db.queryOne(`SELECT * FROM eod_debtor_reports WHERE report_date=?`, [today]);
    if (report?.status === 'submitted') { log('EOD_ESCALATION', 'Report was submitted on time. No escalation needed.'); return; }

    const recorded = await db.query(`SELECT client_id FROM debtor_followups WHERE followup_date=?`, [today]);
    const pendingCount = totalDebtors.length - recorded.length;

    const fm = await db.queryOne(
      `SELECT e.email, e.first_name||' '||e.last_name as name FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='cfo' AND e.status='active' LIMIT 1`
    );

    const escalationRecipients = await db.query(
      `SELECT e.email FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role IN ('md','admin') AND e.status='active' AND e.email IS NOT NULL`
    );
    const emails = escalationRecipients.map(r => r.email).filter(Boolean);
    if (emails.length === 0) { log('EOD_ESCALATION', 'No MD/admin to escalate to.', 'WARN'); return; }

    const { sendEODReportEscalation } = require('./email');
    await sendEODReportEscalation(emails, fm?.name || 'Finance Manager', pendingCount, today);

    if (report) {
      await db.run(`UPDATE eod_debtor_reports SET escalated_at=datetime('now') WHERE id=?`, [report.id]);
    } else {
      const { v4: uuid } = require('uuid');
      await db.run(`INSERT INTO eod_debtor_reports (id, report_date, status, escalated_at) VALUES (?, ?, 'pending', datetime('now'))`, [uuid(), today]);
    }

    log('EOD_ESCALATION', `Escalated to ${emails.join(', ')} — ${pendingCount} account(s) still missing status`);
  } catch (err) {
    log('EOD_ESCALATION', `ERROR: ${err.message}`, 'ERROR');
  }
}

// ── HELPER: COMPILE & SEND EOD REPORT TO MD ───────────────────────────────────
// Called directly by the debtors API once the FM submits (not on a cron schedule)

async function compileAndSendEODReport(reportDate) {
  const db = await getDB();
  const { sendEODDebtorReportToMD } = require('./email');

  const entries = await db.query(
    `SELECT c.name, c.outstanding, df.status, df.note, df.next_followup_date
     FROM debtor_followups df JOIN clients c ON df.client_id=c.id
     WHERE df.followup_date=? ORDER BY c.outstanding DESC`,
    [reportDate]
  );
  if (entries.length === 0) { log('EOD_COMPILE', 'No entries to compile.', 'WARN'); return; }

  const fmRecord = await db.queryOne(
    `SELECT submitted_by FROM eod_debtor_reports WHERE report_date=?`, [reportDate]
  );
  const fm = fmRecord?.submitted_by
    ? await db.queryOne(`SELECT first_name||' '||last_name as name FROM employees WHERE id=?`, [fmRecord.submitted_by])
    : null;

  const md = await db.queryOne(
    `SELECT e.email FROM employees e JOIN users u ON u.employee_id=e.id WHERE u.role='md' AND e.status='active' LIMIT 1`
  );
  if (!md?.email) { log('EOD_COMPILE', 'No MD found to send report to.', 'WARN'); return; }

  const totalOutstanding = entries.reduce((s, e) => s + (e.outstanding || 0), 0);
  await sendEODDebtorReportToMD(md.email, reportDate, fm?.name || 'Finance Manager', entries, totalOutstanding);
  log('EOD_COMPILE', `EOD report sent to MD <${md.email}> — ${entries.length} accounts`);
}



function startScheduler() {
  log('SCHEDULER', '=== QSL ERP Scheduler Starting ===');
  log('SCHEDULER', `Node: ${process.version} | TZ: ${process.env.TZ || 'Africa/Nairobi'}`);

  // Imprest overdue — daily at 00:01 EAT
  cron.schedule('1 0 * * *', runImprestOverdue, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Imprest Overdue (daily 00:01)');

  // Compliance alerts — daily at 08:00 EAT
  cron.schedule('0 8 * * *', runComplianceAlerts, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Compliance Alerts (daily 08:00)');

  // Statutory reminders — every day at 07:00, checks if anything due within 10 days
  cron.schedule('0 7 * * *', runStatutoryReminders, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Statutory Reminders (daily 07:00)');

  // Database backup — daily at 02:00 EAT
  cron.schedule('0 2 * * *', runDatabaseBackup, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: DB Backup (daily 02:00)');

  // Fleet alerts — every Monday at 08:00 EAT
  cron.schedule('0 8 * * 1', runFleetAlerts, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Fleet Alerts (Monday 08:00)');

  // Leave balance reset — 1st January at 00:05 EAT
  cron.schedule('5 0 1 1 *', runLeaveBalanceReset, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Leave Balance Reset (1 Jan 00:05)');

  // L&D block check — 1st of every month at 09:00 EAT
  cron.schedule('0 9 1 * *', runLDBlockCheck, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: L&D Block Check (1st of month 09:00)');

  // Client invoice overdue reminders — daily 09:00 EAT
  cron.schedule('0 9 * * *', runClientInvoiceReminders, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Client Invoice Reminders (daily 09:00)');

  // Calibration certificate expiry reminders — daily 09:30 EAT
  cron.schedule('30 9 * * *', runCalibrationExpiryReminders, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Calibration Expiry Reminders (daily 09:30)');

  // Project payment reminders — daily 10:00 EAT
  cron.schedule('0 10 * * *', runProjectPaymentReminders, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Project Payment Reminders (daily 10:00)');

  // Daily debtors list to MD + FM — daily 08:00 EAT
  cron.schedule('0 8 * * *', runDailyDebtorsList, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: Daily Debtors List to MD/FM (daily 08:00)');

  // EOD debtor report reminder to FM — daily 16:00 EAT (1hr before 17:00 deadline)
  cron.schedule('0 16 * * *', runEODReportReminder, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: EOD Debtor Report Reminder (daily 16:00)');

  // EOD debtor report escalation — daily 17:30 EAT (30min after deadline)
  cron.schedule('30 17 * * *', runEODReportEscalation, { timezone: 'Africa/Nairobi' });
  log('SCHEDULER', '✅ Job registered: EOD Debtor Report Escalation (daily 17:30)');

  log('SCHEDULER', '=== All jobs registered. Scheduler running. ===');
}

// ── EXPORT + STANDALONE MODE ──────────────────────────────────────────────────

module.exports = {
  startScheduler,
  // Export individual jobs for manual trigger via API
  runImprestOverdue,
  runComplianceAlerts,
  runStatutoryReminders,
  runDatabaseBackup,
  runFleetAlerts,
  runLeaveBalanceReset,
  runClientInvoiceReminders,
  runCalibrationExpiryReminders,
  runProjectPaymentReminders,
  runDailyDebtorsList,
  runEODReportReminder,
  runEODReportEscalation,
  compileAndSendEODReport,
};

// Run standalone: node src/lib/scheduler.js
if (require.main === module) {
  startScheduler();
  // Also run jobs immediately on start (for testing)
  if (process.argv.includes('--run-now')) {
    (async () => {
      console.log('\nRunning all jobs immediately (--run-now flag)...\n');
      await runImprestOverdue();
      await runComplianceAlerts();
      await runDatabaseBackup();
      await runFleetAlerts();
      await runClientInvoiceReminders();
      await runCalibrationExpiryReminders();
      await runProjectPaymentReminders();
      await runDailyDebtorsList();
      console.log('\nAll jobs completed.');
    })();
  }
}
