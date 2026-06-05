# BoursoImport

Une extension locale pour Wealthfolio qui permet d'importer automatiquement vos transactions financières à partir de vos avis d'opérés Boursorama (au format PDF).

## 🚀 Fonctionnalités (Features)

- **Extraction 100% locale :** Analyse des fichiers PDF Boursorama directement dans l'application via `pdfjs-dist`. Aucune donnée financière n'est envoyée sur des serveurs externes.
- **Reconnaissance intelligente :** Extraction automatique du code ISIN, de la date d'exécution, du type d'ordre (Achat/Vente), de la quantité, du prix unitaire et des frais de transaction.
- **Protection Anti-Doublon :** Vérifie l'historique de votre portefeuille Wealthfolio avant chaque import pour bloquer l'intégration d'un avis d'opéré déjà traité.
- **Mapping ISIN vers Ticker :** Utilise un dictionnaire personnalisable pour lier les codes ISIN bruts de Boursorama aux identifiants réels (UUID) de vos actifs dans Wealthfolio.

## ⚠️ Prérequis (Comment l'utiliser)

Pour que l'importation fonctionne correctement, **l'actif doit déjà être connu de Wealthfolio**. 

1. Lors de votre tout premier investissement sur un nouvel actif (ex: un nouvel ETF), ajoutez cette première transaction manuellement dans l'interface principale de Wealthfolio.
2. Pour tous les achats ou ventes suivants de ce même actif, glissez simplement le PDF Boursorama dans l'extension **BoursoImport**. Le plugin identifiera l'actif existant et injectera la transaction instantanément.

## 🛠️ Développement (Development)

*Note : Ce projet utilise `pnpm` comme gestionnaire de paquets.*

```bash
# Installer les dépendances
pnpm install

# Lancer le serveur de développement (Vite sur le port 3001)
pnpm run dev

# Compiler pour la production
pnpm run build

# Packager l'extension pour Wealthfolio
pnpm run bundle