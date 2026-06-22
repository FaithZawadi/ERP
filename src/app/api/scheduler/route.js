// src/app/api/scheduler/route.js — Manual job trigger + job status API

import { requireRole, ok, err, logAudit } from '../../../lib/auth';
import { query } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireRole('admin', 'md')(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'status';

  try {
    if (section === 'logs') {
      // Return recent scheduler log entries
      const logDir  = require('path').join(process.cwd(), 'logs');
      const fs      = require('fs');
      if (!fs.existsSync(logDir)) return ok([]);
      const today   = new Date().toISOString().slice(0, 10);
      const logFile = require('path').join(logDir, `scheduler-${today}.log`);
      if (!fs.existsSync(logFile)) return ok([]);
      const lines   = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-100);
      return ok(lines.map(l => {
        const m = l.match(/\[(.+?)\] \[SCHEDULER\] \[(.+?)\] \[(.+?)\] (.+)/);
        return m ? { ts: m[1], job: m[2], level: m[3], msg: m[4] } : { raw: l };
      }));
    }

    if (section === 'backup_list') {
      const fs      = require('fs');
      const backDir = require('path').join(process.cwd(), 'database', 'backups');
      if (!fs.existsSync(backDir)) return ok([]);
      const files   = fs.readdirSync(backDir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const stat = fs.statSync(require('path').join(backDir, f));
          return { name: f, size_kb: Math.round(stat.size / 1024), created: stat.mtime };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));
      return ok(files);
    }

    return ok({
      jobs: [
        { id: 'daily_debtors_list',         name: 'Daily Debtors List (MD + FM)',            schedule: 'Daily 08:00 EAT', category: 'client' },
        { id: 'client_invoice_reminders',   name: 'Client Invoice Overdue Reminders',        schedule: 'Daily 09:00 EAT', category: 'client' },
        { id: 'calibration_expiry',         name: 'Calibration Certificate Expiry Reminders', schedule: 'Daily 09:30 EAT', category: 'client' },
        { id: 'project_payment_reminders',  name: 'Project Payment Reminders to Clients',    schedule: 'Daily 10:00 EAT', category: 'client' },
        { id: 'eod_reminder',               name: 'EOD Debtor Report Reminder (to FM)',      schedule: 'Daily 16:00 EAT', category: 'internal' },
        { id: 'eod_escalation',             name: 'EOD Debtor Report Escalation (to MD)',    schedule: 'Daily 17:30 EAT', category: 'internal' },
        { id: 'imprest_overdue',            name: 'Imprest Overdue Internal Check',          schedule: 'Daily 00:01 EAT', category: 'internal' },
        { id: 'compliance_alerts',          name: 'Compliance Expiry Alerts (Internal)',      schedule: 'Daily 08:00 EAT', category: 'internal' },
        { id: 'statutory',                  name: 'Statutory Deadline Reminders (FM)',        schedule: 'Daily 07:00 EAT', category: 'internal' },
        { id: 'db_backup',                  name: 'Database Backup',                         schedule: 'Daily 02:00 EAT', category: 'system' },
        { id: 'fleet_alerts',               name: 'Fleet Insurance & Service Alerts',        schedule: 'Monday 08:00 EAT', category: 'internal' },
        { id: 'leave_reset',                name: 'Annual Leave Balance Reset',              schedule: '1 Jan 00:05 EAT', category: 'system' },
        { id: 'ld_block',                   name: 'L&D Hours Block Check',                  schedule: '1st of month 09:00', category: 'system' },
      ],
    });
  } catch (e) {
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireRole('admin', 'md')(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { job } = body;

  const jobMap = {
    imprest_overdue:             'runImprestOverdue',
    compliance_alerts:           'runComplianceAlerts',
    statutory:                   'runStatutoryReminders',
    db_backup:                   'runDatabaseBackup',
    fleet_alerts:                'runFleetAlerts',
    leave_reset:                 'runLeaveBalanceReset',
    client_invoice_reminders:    'runClientInvoiceReminders',
    calibration_expiry:          'runCalibrationExpiryReminders',
    project_payment_reminders:   'runProjectPaymentReminders',
    daily_debtors_list:          'runDailyDebtorsList',
    eod_reminder:                'runEODReportReminder',
    eod_escalation:              'runEODReportEscalation',
  };

  if (!jobMap[job]) return err(`Unknown job: ${job}`, 400);

  try {
    const scheduler = require('../../../lib/scheduler');
    const fn = scheduler[jobMap[job]];
    if (typeof fn !== 'function') return err('Job function not found', 500);

    // Run async — don't wait (jobs can take time)
    fn().catch(e => console.error(`[Scheduler manual run] ${job}:`, e.message));

    await logAudit(query, {
      userId: auth.user.id, userName: auth.user.name,
      action: `MANUAL_JOB_RUN`, module: 'Scheduler',
      newValue: { job },
    });

    return ok({ triggered: true, job, message: `Job "${job}" triggered. Check logs for results.` });
  } catch (e) {
    return err('Failed to trigger job: ' + e.message, 500);
  }
}
