import React, { useState } from 'react';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { Card, CardContent, Icons } from '@wealthfolio/ui';
import { parseBoursoText } from './parser';

// Imports pour la lecture du PDF
import * as pdfjsLib from 'pdfjs-dist';
// Configuration du Worker spécifique pour Vite
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function BoursoImportView({ ctx }: { ctx: AddonContext }) {
  const [status, setStatus] = useState<string>("En attente d'un fichier...");
  const [extractedText, setExtractedText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Fonction d'extraction du texte page par page
  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const typedarray = new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: typedarray });
    
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        // @ts-ignore - Le type TextItem de PDF.js possède 'str' mais TS le cherche parfois ailleurs
        .map((item) => item.str)
        .join(' ');
        
      fullText += pageText + '\n';
    }
    
    return fullText;
  };

  // Gestionnaire d'événement à la sélection du fichier
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      setStatus('Analyse du PDF en cours...');
      setExtractedText('');
      
      // 1. On lit le texte
      const rawText = await extractTextFromPDF(file);
      setExtractedText(rawText);

      // 2. On analyse le texte avec notre nouveau moteur
      const transactionData = parseBoursoText(rawText);
      
      if (!transactionData) {
        setStatus("Impossible d'extraire les données. S'agit-il bien d'un avis d'opéré Boursorama ?");
        return;
      }

      setStatus(`Opération trouvée : ${transactionData.type} de ${transactionData.quantity} ${transactionData.assetName}. Vérification...`);

      // On doit d'abord récupérer les comptes existants pour avoir un accountId
      const accounts = await ctx.api.accounts.getAll(); // (ou .list() selon ce que l'auto-complétion te dit)
      
      if (!accounts || accounts.length === 0) {
        setStatus("❌ Erreur : Vous n'avez aucun compte (PEA/CTO) créé dans Wealthfolio.");
        return;
      }

      const selectedAccountId = accounts[0].id;
      
      // 1. Le dictionnaire de traduction
      const ISIN_TO_TICKER: Record<string, string> = {
        "FR0013412020": "PAEEM", // Amundi "PAEEM"
        "LU1681043599": "CW8",  // Amundi MSCI World
      };

      const ticker = ISIN_TO_TICKER[transactionData.isin] || transactionData.isin;

      // 2. On récupère tout l'historique de tes activités
      const existingActivities = await ctx.api.activities.getAll();
      
      // On vérifie les doublons
      const isDuplicate = existingActivities.some((act: any) => {
        // 1. On coupe l'heure pour ne garder que la date (YYYY-MM-DD)
        const isSameDate = act.date.startsWith(transactionData.date);
        
        // 2. On utilise le vrai nom de variable (activityType)
        const isSameType = act.activityType === transactionData.type;
        
        // 3. On convertit la quantité texte de Wealthfolio en Nombre pour comparer
        const isSameQuantity = Number(act.quantity) === transactionData.quantity;

        return isSameDate && isSameType && isSameQuantity;
      });

      if (isDuplicate) {
        setStatus("⚠️ Cette transaction existe déjà dans votre portefeuille ! Importation ignorée.");
        return;
      }

      // 3. On cherche une ancienne transaction de cet actif pour lui voler son UUID
      const pastActivity = existingActivities.find((act: any) => 
        act.assetSymbol === ticker || act.assetSymbol === transactionData.isin
      );

      if (!pastActivity) {
        // Si c'est la toute première fois de ta vie que tu achètes cet ETF, Wealthfolio bloque l'API.
        setStatus(`⚠️ Nouvel actif détecté (${ticker}). Veuillez l'ajouter manuellement une première fois dans Wealthfolio, puis relancez le PDF.`);
        return;
      }

      // On récupère l'UUID généré par Wealthfolio
      const realAssetId = pastActivity.assetId;

      
      // 4. L'injection chirurgicale
      setStatus("Création de l'activité en cours...");
      
      await ctx.api.activities.create({
        accountId: selectedAccountId,
        activityType: transactionData.type,
        activityDate: transactionData.date,
        quantity: transactionData.quantity,
        unitPrice: transactionData.unitPrice,
        currency: transactionData.currency,
        fee: transactionData.fee,
        isDraft: false,
        comment: `Automatique via BoursoImport : ${transactionData.assetName}`,
        asset: {
          asset_id: realAssetId, // On lui donne l'UUID exact de la base de données
          id: realAssetId,       // (Au cas où il l'appelle juste 'id')
          symbol: ticker         // Et on lui confirme que c'est bien PAEEM
        }
      } as any);

      setStatus("✅ Succès absolu ! L'activité est dans votre portefeuille.");
      ctx.api.logger.info(`Nouvelle activité importée avec succès ${JSON.stringify(transactionData)}`);
      
    } catch (error) {
      console.error(error);
      ctx.api.logger.error(`Erreur lors de la lecture du PDF ${JSON.stringify(error)}`);
      setStatus("Erreur lors de la lecture du fichier. Vérifiez qu'il s'agit d'un PDF valide.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <Icons.Blocks className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">BoursoImport</h1>
          </div>
          
          <p className="text-muted-foreground mb-6">
            Sélectionnez un avis d'opéré Boursorama au format PDF pour en extraire le texte brut.
          </p>

          <div className="mb-6">
            <input 
              type="file" 
              accept="application/pdf" 
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
            />
          </div>

          <div className="text-sm font-medium mb-4">
            Statut : <span className={isProcessing ? "text-blue-500" : "text-green-600"}>{status}</span>
          </div>

          {/* Affichage du texte brut extrait pour t'aider à créer tes Regex */}
          {extractedText && (
            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-md text-xs font-mono h-64 overflow-y-auto whitespace-pre-wrap border border-slate-200 dark:border-slate-800">
              {extractedText}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function enable(ctx: AddonContext) {
  // Add a sidebar item
  const sidebarItem = ctx.sidebar.addItem({
    id: 'boursoimport',
    label: 'BoursoImport',
    icon: <Icons.Blocks className="h-5 w-5" />,
    route: '/addon/boursoimport',
    order: 100,
  });

  // Add a route
  const Wrapper = () => <BoursoImportView ctx={ctx} />;
  ctx.router.add({
    path: '/addon/boursoimport',
    component: React.lazy(() => Promise.resolve({ default: Wrapper })),
  });

  // Cleanup on disable
  ctx.onDisable(() => {
    try {
      sidebarItem.remove();
    } catch (err) {
      ctx.api.logger.error(`Failed to remove sidebar item ${JSON.stringify(err)}:`);
    }
  });
}