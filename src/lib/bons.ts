import type { BonType } from '../../shared/schemas';
import type { OrderStatus } from './stock';

// Libellés et couleurs propres à chaque type de bon (liste, détail, impression, exports).
export interface BonTypeInfo {
  label: string;        // badge et exports
  title: string;        // en-tête du document imprimé
  partyLabel: string;   // libellé du champ « destination »
  badgeClass: string;
  // Effet de la suppression, annoncé dans la confirmation.
  deleteEffect: string;
}

export const BON_TYPE_INFO: Record<BonType, BonTypeInfo> = {
  sortie: {
    label: 'Sortie', title: 'BON DE SORTIE', partyLabel: 'Destination',
    badgeClass: 'bg-amber-100 text-amber-800',
    deleteEffect: 'Les quantités sorties seront restituées au stock.',
  },
  entree: {
    label: 'Réception', title: 'BON DE RÉCEPTION', partyLabel: 'Fournisseur / Provenance',
    badgeClass: 'bg-emerald-100 text-emerald-800',
    deleteEffect: 'Les quantités reçues seront retirées du stock.',
  },
  commande: {
    label: 'Commande', title: 'BON DE COMMANDE', partyLabel: 'Fournisseur',
    badgeClass: 'bg-sky-100 text-sky-800',
    deleteEffect: 'Aucun effet sur le stock. Les réceptions déjà enregistrées sont conservées.',
  },
  inventaire: {
    label: 'Inventaire', title: 'INVENTAIRE', partyLabel: 'Périmètre',
    badgeClass: 'bg-violet-100 text-violet-800',
    deleteEffect: 'Les ajustements de stock de cet inventaire seront annulés.',
  },
};

export function bonTypeInfo(type: string | undefined): BonTypeInfo {
  return BON_TYPE_INFO[(type as BonType)] ?? BON_TYPE_INFO.sortie;
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; className: string }> = {
  ouverte:   { label: 'En attente',          className: 'bg-sky-100 text-sky-800' },
  partielle: { label: 'Reçue partiellement', className: 'bg-amber-100 text-amber-800' },
  recue:     { label: 'Reçue',               className: 'bg-emerald-100 text-emerald-800' },
};
