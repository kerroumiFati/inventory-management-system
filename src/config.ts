// import.meta.env n'existe que sous Vite (absent quand le module est importé par les tests).
export const API_BASE: string = import.meta.env?.VITE_API_URL || 'http://localhost:3001/api';

// Devise affichée après les montants (ex. « € », « DH ») ; vide par défaut.
export const CURRENCY: string = import.meta.env?.VITE_CURRENCY || '';
