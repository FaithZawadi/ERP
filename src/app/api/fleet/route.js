// src/app/api/fleet/route.js — Fleet Management API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'vehicles';

  try {
    switch (section) {
      case 'vehicles': {
        const rows = await query(
          `SELECT v.*, e.first_name||' '||e.last_name as driver_name
           FROM vehicles v LEFT JOIN employees e ON v.assigned_driver=e.id
           ORDER BY v.reg_no`
        );
        const [stats] = await query(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
                  SUM(CASE WHEN insurance_to <= date('now','+30 days') THEN 1 ELSE 0 END) as insurance_expiring,
                  SUM(CASE WHEN service_due <= date('now','+14 days') THEN 1 ELSE 0 END) as service_due
           FROM vehicles`
        );
        return ok({ stats, vehicles: rows });
      }

      case 'trips': {
        const vehicle_id = searchParams.get('vehicle_id');
        let sql = `SELECT t.*, v.reg_no, e.first_name||' '||e.last_name as driver_name FROM trips t JOIN vehicles v ON t.vehicle_id=v.id LEFT JOIN employees e ON t.driver_id=e.id`;
        const params = [];
        if (vehicle_id) { sql += ` WHERE t.vehicle_id=?`; params.push(vehicle_id); }
        sql += ` ORDER BY t.date DESC LIMIT 100`;
        return ok(await query(sql, params));
      }

      case 'fuel_log': {
        const rows = await query(
          `SELECT t.vehicle_id, v.reg_no, v.make, SUM(t.fuel_litres) as total_litres, SUM(t.fuel_cost) as total_cost, SUM(t.distance) as total_km
           FROM trips t JOIN vehicles v ON t.vehicle_id=v.id GROUP BY t.vehicle_id ORDER BY total_cost DESC`
        );
        return ok(rows);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Fleet GET]', e);
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
      case 'add_vehicle': {
        const { reg_no, make, model, year, class: vclass, assigned_driver, insurance_to, service_due } = body;
        if (!reg_no || !make) return err('reg_no and make required', 400);
        const id = uuid();
        await run(
          `INSERT INTO vehicles (id,reg_no,make,model,year,class,assigned_driver,insurance_to,service_due,status) VALUES (?,?,?,?,?,?,?,?,?,'active')`,
          [id, reg_no, make, model, year, vclass||'C', assigned_driver, insurance_to, service_due]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ADD_VEHICLE', module: 'Fleet', recordId: id, newValue: { reg_no, make } });
        return ok({ id }, 201);
      }

      case 'log_trip': {
        const { vehicle_id, driver_id, date, purpose, from_location, to_location, start_mileage, end_mileage, fuel_litres, fuel_cost, project_id } = body;
        if (!vehicle_id || !purpose) return err('vehicle_id and purpose required', 400);
        const distance = (end_mileage && start_mileage) ? end_mileage - start_mileage : 0;
        const id = uuid();
        await run(
          `INSERT INTO trips (id,vehicle_id,driver_id,date,purpose,from_location,to_location,start_mileage,end_mileage,distance,fuel_litres,fuel_cost,project_id,is_authorised)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          [id, vehicle_id, driver_id||auth.user.employee_id, date||new Date().toISOString().split('T')[0], purpose, from_location, to_location, start_mileage, end_mileage, distance, fuel_litres||0, fuel_cost||0, project_id]
        );
        if (end_mileage) await run(`UPDATE vehicles SET mileage=? WHERE id=?`, [end_mileage, vehicle_id]);
        return ok({ id, distance }, 201);
      }

      case 'update_service': {
        const { vehicle_id, service_date, next_service, notes, mileage } = body;
        if (!vehicle_id) return err('vehicle_id required', 400);
        await run(`UPDATE vehicles SET service_due=?, mileage=COALESCE(?,mileage), status='active' WHERE id=?`, [next_service, mileage, vehicle_id]);
        return ok({ updated: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Fleet POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
