// Brouillons de saisie conservés dans le navigateur : changer de page ne fait pas perdre une
// saisie en cours, et une page peut préparer une saisie (commande proposée, réception d'une commande).

export interface DraftItem {
  productId: string;
  quantity: string | number;
  note: string;
}

export interface Draft {
  items: DraftItem[];
  destination: string;
  note: string;
  // Réception d'une commande : uid et numéro de la commande.
  orderUid?: string | null;
  orderNumber?: string;
  // Message affiché à l'ouverture quand la saisie a été préparée par une autre page.
  preparedBy?: string;
}

export type DraftKind = 'sortie' | 'entree' | 'commande';

const draftKey = (kind: DraftKind) => `stock_draft_${kind}`;

export function loadDraft(kind: DraftKind): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(kind));
    const d = raw ? JSON.parse(raw) as Draft : null;
    return d && Array.isArray(d.items) && d.items.length ? d : null;
  } catch { return null; }
}

export function isDraftEmpty(d: Draft): boolean {
  return !d.destination.trim() && !d.note.trim() && !d.orderUid && d.items.every(i => !i.productId && !i.note.trim());
}

export function saveDraft(kind: DraftKind, draft: Draft): void {
  try {
    if (isDraftEmpty(draft)) localStorage.removeItem(draftKey(kind));
    else localStorage.setItem(draftKey(kind), JSON.stringify(draft));
  } catch {
    // Stockage indisponible (navigation privée...) : le brouillon n'est simplement pas conservé.
  }
}

export function clearDraft(kind: DraftKind): void {
  try { localStorage.removeItem(draftKey(kind)); } catch { /* idem */ }
}

// Prépare la réception d'une commande : restant à recevoir de chaque ligne.
export function receptionDraft(
  order: { uid?: string; number: string; destination?: string },
  lines: { productId: number; remaining: number }[],
): Draft {
  return {
    destination: order.destination ?? '',
    note: `Commande ${order.number}`,
    orderUid: order.uid ?? null,
    orderNumber: order.number,
    preparedBy: 'commande',
    items: lines.filter(l => l.remaining > 0).map(l => ({ productId: String(l.productId), quantity: l.remaining, note: '' })),
  };
}

// Remplace un brouillon après confirmation s'il contient déjà une saisie.
export function replaceDraft(kind: DraftKind, draft: Draft): boolean {
  const current = loadDraft(kind);
  if (current && !isDraftEmpty(current) && !confirm('Une saisie est déjà en cours sur cette page. La remplacer ?')) return false;
  saveDraft(kind, draft);
  return true;
}
