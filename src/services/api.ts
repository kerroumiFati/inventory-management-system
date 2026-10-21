import { API_BASE } from '../config';

// Appel authentifié à l'API ; lève une Error portant le message du serveur.
export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem('stock_auth_token');
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new Error('Serveur injoignable. Cette action nécessite une connexion au serveur.');
  }
  const body = await res.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!res.ok) throw new Error(body?.error || `Erreur serveur (${res.status})`);
  return body as T;
}
