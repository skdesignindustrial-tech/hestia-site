// Service layer for the "Visualizar com IA" feature.
// Calls the Vercel Serverless Function at /api/visualize, which holds the
// Gemini API key server-side (process.env.GEMINI_API_KEY) and never exposes
// it to the browser.
//
// Request payload:
//   { image: <data URL>, description: string, furnitureType: string|null, material: string|null }
// Success response:
//   { imageUrl: string }
// Error response:
//   { message: string }

export async function generateVisualization({ image, description, furnitureType, material }) {
  let res;
  try {
    res = await fetch('/api/visualize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, description, furnitureType, material }),
    });
  } catch (networkErr) {
    throw Object.assign(new Error('NETWORK_ERROR'), {
      code: 'NETWORK_ERROR',
      userMessage: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.message || 'API_ERROR'), {
      code: 'API_ERROR',
      userMessage: err.message || 'Não foi possível gerar a visualização. Tente novamente em alguns instantes.',
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!data.imageUrl) {
    throw Object.assign(new Error('NO_IMAGE'), {
      code: 'NO_IMAGE',
      userMessage: 'A IA não retornou uma imagem para este pedido. Tente descrever de outra forma.',
    });
  }

  return { imageUrl: data.imageUrl };
}
