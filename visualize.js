// Vercel Serverless Function — POST /api/visualize
// Edits a real user photo with Gemini 2.5 Flash Image, preserving the room's
// architecture and only inserting/modifying the requested piece of furniture.
//
// Required env var (set in Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY

const MAX_BODY_BYTES = 8 * 1024 * 1024; // ~8MB decoded request body cap
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

function parseDataUrl(dataUrl) {
  // Expected shape: "data:<mime>;base64,<data>"
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Método não permitido.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ message: 'A integração de IA ainda não está configurada (GEMINI_API_KEY ausente).' });
  }

  const { image, description, furnitureType, material } = req.body || {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ message: 'Envie a foto do ambiente.' });
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ message: 'Descreva o móvel que você deseja.' });
  }

  const parsed = parseDataUrl(image);
  if (!parsed) {
    return res.status(400).json({ message: 'Formato de imagem inválido.' });
  }
  if (!ALLOWED_MIME.includes(parsed.mime)) {
    return res.status(400).json({ message: 'Formato de imagem não suportado. Envie JPEG, PNG ou WebP.' });
  }
  // Rough size check on the raw request payload (base64 is ~33% larger than binary).
  const approxBytes = Buffer.byteLength(image, 'utf8');
  if (approxBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ message: 'A foto é muito grande. Envie uma imagem menor.' });
  }

  const promptParts = [
    'Use a fotografia enviada como base. Preserve a arquitetura e a aparência real do ambiente. ' +
      'Mantenha paredes, piso, portas, janelas, iluminação, perspectiva, proporções e elementos ' +
      'existentes que não foram solicitados para alteração. Insira ou modifique somente o móvel ' +
      'solicitado pelo usuário. O resultado deve parecer uma fotografia realista do mesmo ambiente ' +
      'depois da intervenção. Não transforme a imagem em render 3D. Não mude o cômodo inteiro. ' +
      'Não invente outra arquitetura. Não remova elementos existentes sem solicitação.',
  ];
  if (furnitureType) promptParts.push(`Tipo de móvel: ${furnitureType}.`);
  promptParts.push(`Descrição do usuário: ${description.trim()}.`);
  if (material) promptParts.push(`Material/acabamento: ${material}.`);
  const prompt = promptParts.join(' ');

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: parsed.mime, data: parsed.base64 } },
              ],
            },
          ],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return res.status(502).json({
        message: 'A API de geração de imagem retornou um erro.',
        detail: errText.slice(0, 500),
      });
    }

    const data = await geminiRes.json();
    const outPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.inline_data || p.inlineData);
    const inlineData = outPart?.inline_data || outPart?.inlineData;

    if (!inlineData?.data) {
      return res.status(502).json({ message: 'A IA não retornou nenhuma imagem para este pedido.' });
    }

    const outMime = inlineData.mime_type || inlineData.mimeType || 'image/png';
    // Nothing is persisted server-side — the generated image is returned directly as a data URL.
    return res.status(200).json({ imageUrl: `data:${outMime};base64,${inlineData.data}` });
  } catch (err) {
    return res.status(500).json({ message: 'Erro inesperado ao gerar a visualização.' });
  }
}
