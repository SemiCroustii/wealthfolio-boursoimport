export interface BoursoTransaction {
  type: 'BUY' | 'SELL';
  date: string; // Format YYYY-MM-DD attendu par Wealthfolio
  isin: string;
  assetName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  fee: number;
  totalAmount: number;
}

// Fonction utilitaire pour transformer "1 050,50" en 1050.50
const parseFrenchNumber = (str: string): number => {
  if (!str) return 0;
  const cleanStr = str.replace(/\s+/g, '').replace(',', '.');
  return parseFloat(cleanStr);
};

// Fonction utilitaire pour transformer "19/05/2026" en "2026-05-19"
const parseFrenchDate = (dateStr: string): string => {
  const [day, month, year] = dateStr.split('/');
  return `${year}-${month}-${day}`;
};

export const parseBoursoText = (rawText: string): BoursoTransaction | null => {
  try {
    // 1. Nettoyage initial : on remplace tous les sauts de ligne et espaces multiples par un seul espace
    const cleanText = rawText.replace(/\s+/g, ' ');

    // 2. Sens de la transaction
    const isBuy = /ACHAT\s+COMPTANT/i.test(cleanText);
    const isSell = /VENTE\s+COMPTANT/i.test(cleanText);
    if (!isBuy && !isSell) throw new Error("Impossible de déterminer le sens de l'opération");
    const type = isBuy ? 'BUY' : 'SELL';

    // 3. Extraction de l'ISIN
    const isinMatch = cleanText.match(/Code ISIN\s*:\s*([A-Z0-9]{12})/i);
    const isin = isinMatch ? isinMatch[1] : '';

    // 4. Extraction du Prix et de la Devise
    const priceMatch = cleanText.match(/Cours exécuté\s*:\s*([\d\s]+,\d+)\s*([A-Z]{3})/i);
    const unitPrice = priceMatch ? parseFrenchNumber(priceMatch[1]) : 0;
    const currency = priceMatch ? priceMatch[2] : 'EUR';

    // 5. Extraction de la Date, Quantité et Nom de l'actif
    const execMatch = cleanText.match(/Informations sur l'exécution\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}\s+(\d+)\s+(.+?)\s+Référence/i);
    const date = execMatch ? parseFrenchDate(execMatch[1]) : '';
    const quantity = execMatch ? parseInt(execMatch[2], 10) : 0;
    const assetName = execMatch ? execMatch[3].trim() : '';

    // 6. Extraction des montants et frais (Brut, Frais, Net)
    // On cherche la suite de 3 montants avec leur devise à la fin du document
    const amountsMatch = cleanText.match(/([\d\s]+,\d+)\s*[A-Z]{3}\s+([\d\s]+,\d+)\s*[A-Z]{3}\s+([\d\s]+,\d+)\s*[A-Z]{3}/i);
    
    let fee = 0;
    let totalAmount = 0;
    
    if (amountsMatch) {
      fee = parseFrenchNumber(amountsMatch[2]); // La commission / frais
      totalAmount = parseFrenchNumber(amountsMatch[3]); // Le montant net
    }

    if (!isin || !date || quantity === 0) {
      throw new Error("Données obligatoires manquantes.");
    }

    return {
      type,
      date,
      isin,
      assetName,
      quantity,
      unitPrice,
      currency,
      fee,
      totalAmount
    };

  } catch (error) {
    console.error("Échec du parsing de l'avis Boursorama :", error);
    return null;
  }
};