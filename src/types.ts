export type PageKey =
  | 'dashboard'
  | 'stock'
  | 'products'
  | 'movement'
  | 'entree'
  | 'commande'
  | 'reappro'
  | 'inventaire'
  | 'rapports'
  | 'bons'
  | 'bon-detail'
  | 'import'
  | 'users';

export type NavigateFn = (page: PageKey, extra?: { bonId?: number }) => void;
