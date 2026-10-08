// Designer access gate.  Lightweight, client-side only: the PIN is compared against a SHA-256 hash, and the
// designer state lives in sessionStorage.  This keeps presentation UI clean for clients; it is NOT real security
// (anything a browser can show can be read by a determined user).  Change the PIN by replacing PIN_HASH with
//   printf '%s' NEWPIN | shasum -a 256
const PIN_HASH = '597186037f2be9952d3cca8e818c2738e4ee2aba01532c982ba1cf8a9a3fc028';
const KEY = 'aygis.designer';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function isDesigner() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
export async function verifyPin(pin) {
  if (!crypto.subtle) return false;
  const ok = (await sha256(String(pin).trim())) === PIN_HASH;
  if (ok) { try { sessionStorage.setItem(KEY, '1'); } catch (e) { } }
  return ok;
}
export function leaveDesigner() { try { sessionStorage.removeItem(KEY); } catch (e) { } }
