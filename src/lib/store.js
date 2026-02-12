let backendPromise;

async function getBackend() {
  if (!backendPromise) {
    const preferred = process.env.STORAGE_BACKEND;
    const usePostgres = preferred === 'postgres';

    backendPromise = usePostgres ? import('./store-postgres.js') : import('./store-json.js');
  }

  try {
    return await backendPromise;
  } catch (error) {
    const preferred = process.env.STORAGE_BACKEND;
    if (preferred === 'postgres') {
      throw new Error(
        `Failed to initialize postgres store: ${error instanceof Error ? error.message : String(error)}. ` +
          'Install dependency "pg" and set a valid DATABASE_URL, or set STORAGE_BACKEND=json.'
      );
    }
    throw error;
  }
}

export async function listTenders() {
  return (await getBackend()).listTenders();
}

export async function createTender(input) {
  return (await getBackend()).createTender(input);
}

export async function upsertTenderFromConnector(input) {
  return (await getBackend()).upsertTenderFromConnector(input);
}

export async function getTenderById(tenderId) {
  return (await getBackend()).getTenderById(tenderId);
}

export async function addDocument(tenderId, input) {
  return (await getBackend()).addDocument(tenderId, input);
}

export async function listEvidenceAssets() {
  return (await getBackend()).listEvidenceAssets();
}

export async function addEvidenceAsset(asset) {
  return (await getBackend()).addEvidenceAsset(asset);
}

export async function replaceRequirements(tenderId, requirements, extractionMeta = {}) {
  return (await getBackend()).replaceRequirements(tenderId, requirements, extractionMeta);
}

export async function listAuditEvents(tenderId) {
  return (await getBackend()).listAuditEvents(tenderId);
}

export async function verifyTenderAuditChain(tenderId) {
  return (await getBackend()).verifyTenderAuditChain(tenderId);
}

export async function backfillTenderAuditChain(tenderId, options = {}) {
  return (await getBackend()).backfillTenderAuditChain(tenderId, options);
}

export async function updateTenderGate(tenderId, gateKey, input) {
  return (await getBackend()).updateTenderGate(tenderId, gateKey, input);
}

export async function getTenderSections(tenderId) {
  return (await getBackend()).getTenderSections(tenderId);
}

export async function updateTenderSection(tenderId, sectionKey, input) {
  return (await getBackend()).updateTenderSection(tenderId, sectionKey, input);
}

export async function saveTenderAnalysis(tenderId, analysis) {
  return (await getBackend()).saveTenderAnalysis(tenderId, analysis);
}

export async function getTenderAnalysis(tenderId) {
  return (await getBackend()).getTenderAnalysis(tenderId);
}

export async function addConnectorRun(run) {
  return (await getBackend()).addConnectorRun(run);
}

export async function listConnectorRuns(limit = 30) {
  return (await getBackend()).listConnectorRuns(limit);
}

export async function replaceTenderChunks(tenderId, chunks, indexMeta = {}) {
  return (await getBackend()).replaceTenderChunks(tenderId, chunks, indexMeta);
}

export async function searchTenderChunks(tenderId, query, options = {}) {
  return (await getBackend()).searchTenderChunks(tenderId, query, options);
}
