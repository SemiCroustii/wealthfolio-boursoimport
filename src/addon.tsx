import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  const [errorLog, setErrorLog] = useState<{ fileName: string; message: string }[]>([]);
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
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);

    try {
      setIsProcessing(true);
      setErrorLog([]);

      // On prépare des compteurs pour le résumé final
      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      // Les données globales dont on a besoin une seule fois
      const accounts = await ctx.api.accounts.getAll();
      const existingActivities = await ctx.api.activities.getAll();
      const selectedAccountId = accounts[0]?.id;

      const ISIN_TO_TICKER: Record<string, string> = {
        "FR0013412020": "PAEEM", // Amundi "PAEEM"
        "LU1681043599": "CW8",  // Amundi MSCI World
        "IE0002XZSHO1": "WPEA" // iShares MSCI World 
      };

      if (!selectedAccountId) {
        setStatus("❌ Erreur : Vous n'avez aucun compte créé dans Wealthfolio.");
        setIsProcessing(false);
        return;
      }

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];

        // Mise à jour de l'UI pour faire patienter l'utilisateur
        setStatus(`Traitement du fichier ${i + 1} sur ${filesArray.length} : ${file.name}...`);

        try {
          // 1. Lecture et extraction
          const rawText = await extractTextFromPDF(file);
          const transactionData = parseBoursoText(rawText);

          if (!transactionData) {
            ctx.api.logger.warn(`Impossible d'analyser le fichier : ${file.name}`);
            setErrorLog(prev => [...prev, { fileName: file.name, message: "Format du PDF non reconnu ou illisible." }]);
            errorCount++;
            continue; // On passe au fichier suivant sans crasher
          }

          const ticker = ISIN_TO_TICKER[transactionData.isin] || transactionData.isin;

          const pastActivity = existingActivities.find((act: any) =>
            act.assetSymbol === ticker || act.assetSymbol === transactionData.isin
          );

          if (!pastActivity) {
            ctx.api.logger.warn(`Actif inconnu (${ticker}) pour le fichier ${file.name}.`);
            setErrorLog(prev => [...prev, { fileName: file.name, message: `Actif inconnu (${ticker}). Ajoutez-le manuellement une première fois.` }]);
            errorCount++;
            continue;
          }
          const realAssetId = pastActivity.assetId;

          // 3. Vérification des doublons
          const isDuplicate = existingActivities.some((act: any) => {
            const isSameDate = act.date.startsWith(transactionData.date);
            const isSameType = act.activityType === transactionData.type;
            const isSameQuantity = Number(act.quantity) === transactionData.quantity;
            return isSameDate && isSameType && isSameQuantity;
          });

          if (isDuplicate) {
            duplicateCount++;
            continue;
          }

          // 4. L'injection finale
          await ctx.api.activities.create({
            accountId: selectedAccountId,
            activityType: transactionData.type,
            activityDate: transactionData.date,
            quantity: transactionData.quantity,
            unitPrice: transactionData.unitPrice,
            currency: transactionData.currency,
            fee: transactionData.fee,
            isDraft: false,
            comment: `BoursoImport : ${transactionData.assetName}`,
            asset: {
              asset_id: realAssetId,
              id: realAssetId,
              symbol: ticker
            }
          } as any);

          // Si on arrive ici, c'est un succès !
          successCount++;

          // On met à jour notre tableau local pour que le prochain fichier 
          // de la boucle sache que celui-ci vient d'être ajouté (évite les doublons dans le même lot)
          existingActivities.push({
            date: transactionData.date,
            activityType: transactionData.type,
            quantity: transactionData.quantity.toString(),
            assetId: realAssetId,
            assetSymbol: ticker
          } as any);
        } catch (fileError: any) {
          setErrorLog(prev => [...prev, { fileName: file.name, message: fileError.message || "Erreur technique inattendue." }]);
          console.error(`Erreur sur le fichier ${file.name}:`, fileError);
          errorCount++;
        }
      }

      // 5. Le rapport final
      setStatus(`✅ Terminé ! ${successCount} importés, ${duplicateCount} ignorés (doublons), ${errorCount} en erreur.`)

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
              multiple
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Le statut global */}
          {status && (
            <div className="mt-4 text-sm font-medium">
              {status}
            </div>
          )}

          {/* Le journal d'erreurs détaillé */}
          {errorLog.length > 0 && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-md border border-red-200 text-sm text-left">
              <h3 className="font-bold mb-2">⚠️ Fichiers en erreur ({errorLog.length}) :</h3>
              <ul className="list-disc pl-5 space-y-1">
                {errorLog.map((err, idx) => (
                  <li key={idx}>
                    <strong>{err.fileName}</strong> : {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

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
    icon: 'invoice',
    route: '/addon/boursoimport',
    order: 100,
  });

  // Add a route
  let root: Root | null = null;
  ctx.router.add({
    path: '/addon/boursoimport',
    render: ({ root: routeRoot }) => {
      root ??= createRoot(routeRoot);
      root.render(<BoursoImportView ctx={ctx} />);
    },
  });

  // Cleanup on disable
  ctx.onDisable(() => {
    root?.unmount();
    root = null;
    try {
      sidebarItem.remove();
    } catch (err) {
      ctx.api.logger.error(`Failed to remove sidebar item ${JSON.stringify(err)}:`);
    }
  });
}