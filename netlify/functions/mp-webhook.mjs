// Notificaciones de Mercado Pago. Nunca se confía en el contenido: siempre se consulta el pago real.
import { json, verifyMpSignature, syncPaymentById } from '../lib/core.mjs';

export default async (req) => {
  const u = new URL(req.url);
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const type = u.searchParams.get('type') || u.searchParams.get('topic') || body.type || body.topic || '';
  const dataId = String(u.searchParams.get('data.id') || (body.data && body.data.id) || (type === 'payment' ? u.searchParams.get('id') || '' : ''));
  if (type !== 'payment' || !/^\d+$/.test(dataId)) return json({ ok: true, ignored: true });

  const sig = verifyMpSignature(req, dataId);
  if (sig === 'invalida') console.warn('Firma de Mercado Pago no válida para pago', dataId, '(se verifica igual consultando a Mercado Pago)');

  try {
    await syncPaymentById(dataId);
    return json({ ok: true });
  } catch (e) {
    console.error('webhook', e.message);
    // pago que no existe en esta cuenta: no tiene caso que Mercado Pago reintente
    if (e.status === 404) return json({ ok: true, notFound: true });
    // 500 => Mercado Pago reintenta más tarde
    return json({ ok: false }, 500);
  }
};
export const config = { path: '/api/mp-webhook' };
