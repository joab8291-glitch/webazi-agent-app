/**
 * Lets one agent export their Data Plans catalog as a real .json file and
 * share it (WhatsApp, email, Bluetooth, "Save to Files", etc.), and lets
 * another agent import that same file into their own app to set up
 * matching plans — see store/useDataPlanStore.ts's exportPlansJson /
 * importPlans for the actual serialization.
 */

// SDK 54 moved the classic path/string-based FileSystem API (cacheDirectory,
// writeAsStringAsync, readAsStringAsync, EncodingType) to the /legacy
// entrypoint — the new default export is an object-oriented File/Directory
// API instead. Using /legacy here keeps this file matching the same
// AsyncStorage-era style the rest of the app's services use.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { type DataPlan, type DataPlanExport, type ImportPlansMode } from '@/store/useDataPlanStore';

function fileNameFor(when: Date = new Date()): string {
  const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `webazi-data-plans-${stamp}.json`;
}

/**
 * Writes the given export JSON to a file and opens the native share sheet
 * so the agent can send it to another agent (or save it for later).
 */
export async function exportPlansToFile(json: string): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${fileNameFor()}`;
  await FileSystem.writeAsStringAsync(fileUri, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Share Data Plans',
      UTI: 'public.json',
    });
  } else {
    throw new Error('Sharing is not available on this device.');
  }
}

export type PickedPlansImport = {
  fileName: string;
  parsed: DataPlanExport;
};

/**
 * Opens the document picker for a .json file, reads and parses it, and
 * validates it looks like a Webazi Data Plans export. Throws with a
 * user-facing message on anything that doesn't check out. Returns null if
 * the agent cancels the picker.
 */
export async function pickPlansImportFile(): Promise<PickedPlansImport | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const raw = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as any).type !== 'webazi-data-plans-export' ||
    !Array.isArray((parsed as any).plans)
  ) {
    throw new Error("That file doesn't look like a Webazi Data Plans export.");
  }

  return { fileName: asset.name, parsed: parsed as DataPlanExport };
}

/** Basic shape check on each imported plan so a garbled file can't silently corrupt the store. */
export function isValidImportedPlan(p: any): p is DataPlan {
  return (
    p &&
    typeof p === 'object' &&
    typeof p.name === 'string' &&
    typeof p.category === 'string' &&
    typeof p.sellingPrice === 'number' &&
    typeof p.ussd === 'string' &&
    Array.isArray(p.ussdVariants)
  );
}

export type { ImportPlansMode };
