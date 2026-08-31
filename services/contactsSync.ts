import * as Contacts from 'expo-contacts';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';
import { useClientStore } from '@/store/useClientStore';

/**
 * Client -> Contacts Sync. Requires expo-contacts, which was added to
 * package.json but needs `npx expo install expo-contacts` (to lock the
 * exact SDK-matched version) followed by `npx expo prebuild` before the
 * native module actually exists — same one-time step this repo already
 * needed for native SEND_SMS. Everything here fails soft (returns
 * {ok:false}) rather than throwing if that hasn't happened yet.
 *
 * "App only" mode needs none of this — the client list already lives
 * in useClientStore and is browsable from the Client Metrics screen.
 * This module only runs when contactsSaveDestination === 'device'.
 */

export async function syncClientToContacts(client: {
  key: string;
  phone: string;
  name: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const settings = useAppSettingsStore.getState();

  if (!settings.autoSaveToContacts) return { ok: true }; // feature off — not an error
  if (settings.contactsSaveDestination !== 'device') return { ok: true }; // App-only mode

  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      return { ok: false, reason: 'Contacts permission not granted' };
    }

    const suffix = settings.contactsKeywordSuffix.trim();
    const displayName = client.name
      ? `${client.name} (${suffix})`.trim()
      : `${client.phone} (${suffix})`.trim();

    // NOTE: deliberately no `name:` filter here. expo-contacts'
    // getContactsAsync `name` option searches contact *display names*,
    // not phone numbers — a named client is saved as "{name} (BG)",
    // whose display name never contains the phone digits, so filtering
    // by `name: client.phone` silently returned zero candidates for
    // every named client and caused a new duplicate contact on every
    // re-sync. Fetch all contacts with phone numbers instead and match
    // on the digits ourselves, exactly as the .find() below already did.
    const existing = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
    });

    const matched = existing.data.find((c) =>
      (c.phoneNumbers ?? []).some((p) => (p.number ?? '').replace(/\D/g, '').endsWith(client.key))
    );

    if (matched) {
      if (settings.contactsDuplicateHandling === 'skip') {
        return { ok: true };
      }
      if (settings.contactsDuplicateHandling === 'update') {
        await Contacts.updateContactAsync({
          id: matched.id,
          [Contacts.Fields.Name]: displayName,
        } as any);
        useClientStore.getState().markContactSynced(client.key);
        return { ok: true };
      }
      // 'duplicate' falls through to create a new contact below.
    }

    await Contacts.addContactAsync({
      [Contacts.Fields.Name]: displayName,
      [Contacts.Fields.PhoneNumbers]: [{ number: client.phone, label: 'mobile' }],
    } as any);

    useClientStore.getState().markContactSynced(client.key);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}
