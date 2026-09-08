export type PageKey =
  | 'dashboard'
  | 'stock'
  | 'products'
  | 'movement'
  | 'bons'
  | 'bon-detail'
  | 'import';

export type NavigateFn = (page: PageKey, extra?: { bonId?: number }) => void;
