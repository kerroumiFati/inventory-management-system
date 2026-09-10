import { rowSortingFeature, createSortedRowModel, tableFeatures } from '@tanstack/react-table';

// Feature set partagé par les tableaux de l'app (Produits, Stock) : tri de colonnes uniquement.
// Défini statiquement hors composant, comme recommandé par TanStack Table v9.
export const sortableTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
