/*
 * Everything that depends on Google Meet's page lives here, so when Meet
 * changes its wording only this file needs updating. Matching is by visible
 * text and accessible names (what a screen reader hears), not CSS classes,
 * which Meet renames often.
 */

/** Pre-join screen. */
export const NAME_INPUT = /your name/i;
export const MIC_OFF_BUTTON = /turn off microphone/i;
export const MIC_ON_BUTTON = /turn on microphone/i;
export const CAMERA_OFF_BUTTON = /turn off camera/i;
export const CAMERA_ON_BUTTON = /turn on camera/i;
/** Meet's own shortcuts, used when clicking the button didn't take. */
export const MIC_SHORTCUT = process.platform === "darwin" ? "Meta+d" : "Control+d";
export const CAMERA_SHORTCUT = process.platform === "darwin" ? "Meta+e" : "Control+e";
export const JOIN_BUTTON = /ask to join|join now|join anyway/i;
/** Dialogs Meet may show before the join button is usable. */
export const DISMISS_BUTTONS = /^(got it|dismiss|continue without microphone and camera|continue without microphone|no thanks)$/i;

/** In the call: only an admitted participant has this button. */
export const LEAVE_BUTTON = /leave call/i;

/** Status texts after asking to join. Checked in this order. */
export const DECLINED_TEXT = /denied your request|removed you from the meeting|you've been removed|your request to join was declined/i;
export const TIMEOUT_TEXT = /no one responded to your request|no one let you in/i;
export const BLOCKED_TEXT = /you can't join this (video )?call|you cannot join this (video )?call|this call is restricted/i;
export const ENDED_TEXT = /(this|the) meeting has ended|check your meeting code|invalid video call name/i;
export const WAITING_TEXT = /asking to be let in|please wait until a meeting host|someone will let you in|waiting for the host/i;
