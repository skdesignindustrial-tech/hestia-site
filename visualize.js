// Vercel Serverless Function — POST /api/visualize
// Edits the user's real photo with Gemini 2.5 Flash Image, preserving the
// room and only inserting/modifying the requested furniture.
//
// Required env var (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY
//
// CommonJS on purpose: works on Vercel without a package.json.

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const MAX_IMAGE_CHARS = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Método não permitido.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ message: 'A integração de IA ainda não está configurada (GEMINI_API_KEY ausente no servidor).' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { image, description, furnitureType, material } = body || {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ message: 'Envie a foto do ambiente.' });
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ message: 'Descreva o móvel que você deseja.' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ message: 'A foto é muito grande. Envie uma imagem menor.' });
  }
  const parsed = parseDataUrl(image);
  if (!parsed) return res.status(400).json({ message: 'Formato de imagem inválido.' });
  if (!ALLOWED_MIME.includes(parsed.mime)) {
    return res.status(400).json({ message: 'Formato de imagem não suportado. Envie JPEG, PNG ou WebP.' });
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

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: promptParts.join(' ') },
              { inlineData: { mimeType: parsed.mime, data: parsed.base64 } },
            ],
          }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      }
    );

    const data = await geminiRes.json().catch(() => ({}));

    if (!geminiRes.ok) {
      const apiMsg = data && data.error && data.error.message ? data.error.message : '';
      console.error('Gemini error', geminiRes.status, apiMsg);
      const message =
        geminiRes.status === 429 ? 'Limite de uso da IA atingido. Tente novamente em alguns minutos.' :
        geminiRes.status === 403 || geminiRes.status === 401 ? 'A chave da IA não tem permissão para este modelo. Verifique a configuração no Google Cloud.' :
        'A API de geração de imagem retornou um erro.';
      return res.status(502).json({ message });
    }

    const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = parts.find((p) => p.inlineData || p.inline_data);
    const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);

    if (!inline || !inline.data) {
      const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
      return res.status(502).json({
        message: blocked
          ? 'O pedido foi bloqueado pelos filtros de segurança da IA. Tente descrever de outra forma.'
          : 'A IA não retornou nenhuma imagem para este pedido. Tente descrever de outra forma.',
      });
    }

    const outMime = inline.mimeType || inline.mime_type || 'image/png';
    // Nothing is stored — the generated image goes straight back to the browser.
    return res.status(200).json({ imageUrl: `data:${outMime};base64,${inline.data}` });
  } catch (err) {
    console.error('visualize handler error', err);
    return res.status(500).json({ message: 'Erro inesperado ao gerar a visualização.' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
