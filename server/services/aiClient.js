/**
 * server/services/aiClient.js
 * Handler service layer for communicating with the AI API (e.g. Gemini API, OpenAI API).
 */

async function getAIChatResponse(userMessage, academicContext) {
  // TODO: Setup Gemini API client instantiation (e.g. @google/generative-ai).
  // TODO: Build prompt system instructions incorporating mock academic data context.
  // TODO: Return generated text from the model API call.
  return `AI response containing information about: ${JSON.stringify(academicContext)}`;
}

module.exports = {
  getAIChatResponse,
};
