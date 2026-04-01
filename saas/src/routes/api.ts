import { Router, type Request, type Response } from 'express';
import { getUserSettings } from '../db.js';
import {
  getBotStatus, getLastDecisions, getLastErrors,
  spawnBot, stopBot, restartBot,
} from '../bot-manager.js';

const router = Router();

// ── GET /api/status ───────────────────────────────────────────
router.get('/status', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const status = getBotStatus(userId);
  res.json({ ok: true, status });
});

// ── GET /api/logs?limit=N ─────────────────────────────────────
router.get('/logs', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
  const decisions = getLastDecisions(userId, limit);
  res.json({ ok: true, decisions });
});

// ── GET /api/errors ───────────────────────────────────────────
router.get('/errors', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const errors = getLastErrors(userId);
  res.json({ ok: true, errors });
});

// ── POST /api/bot/start ───────────────────────────────────────
router.post('/bot/start', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const settings = getUserSettings(userId);
  if (!settings?.anthropic_api_key) {
    res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });
    return;
  }
  spawnBot(userId, settings);
  res.json({ ok: true });
});

// ── POST /api/bot/stop ────────────────────────────────────────
router.post('/bot/stop', (req: Request, res: Response) => {
  stopBot(req.session!.userId!);
  res.json({ ok: true });
});

// ── POST /api/bot/restart ─────────────────────────────────────
router.post('/bot/restart', (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const settings = getUserSettings(userId);
  if (!settings?.anthropic_api_key) {
    res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });
    return;
  }
  restartBot(userId, settings);
  res.json({ ok: true });
});

export { router as apiRouter };
