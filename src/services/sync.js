import { db } from '../db';
import { API_BASE as API } from '../config';

function authHeaders() {
  const token = localStorage.getItem('stock_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function checkServer() {
  try {
    const r = await fetch(`${API}/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

// Envoie toutes les données locales → serveur SQLite
export async function pushToServer() {
  const [products, movements, bons, bonItems] = await Promise.all([
    db.products.toArray(),
    db.movements.toArray(),
    db.bons.toArray(),
    db.bonItems.toArray(),
  ]);

  const res = await fetch(`${API}/sync/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ products, movements, bons, bonItems }),
  });

  if (res.status === 401) throw new Error('Session expirée. Veuillez vous reconnecter.');
  if (!res.ok) throw new Error('Échec de la synchronisation vers le serveur');
  return res.json();
}

// Récupère toutes les données du serveur → remplace le local
export async function pullFromServer() {
  const res = await fetch(`${API}/sync/pull`, { headers: authHeaders() });

  if (res.status === 401) throw new Error('Session expirée. Veuillez vous reconnecter.');
  if (!res.ok) throw new Error('Échec de la récupération depuis le serveur');

  const { products, movements, bons, bonItems } = await res.json();

  await db.transaction('rw', db.products, db.movements, db.bons, db.bonItems, async () => {
    await db.products.clear();
    await db.movements.clear();
    await db.bons.clear();
    await db.bonItems.clear();

    if (products.length)  await db.products.bulkAdd(products);
    if (movements.length) await db.movements.bulkAdd(movements);
    if (bons.length)      await db.bons.bulkAdd(bons);
    if (bonItems.length)  await db.bonItems.bulkAdd(bonItems);
  });

  return { products: products.length, movements: movements.length, bons: bons.length };
}
