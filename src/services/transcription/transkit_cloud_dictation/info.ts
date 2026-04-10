export const info = {
    name: 'transkit_cloud_dictation',
    icon: 'transkit.png',
    cloud: true,
    // This service is designed for short sessions: VoiceAnywhere dictation and Narration PTT.
    // Exclude it from the main Monitor transcription service list (voiceInputOnly services
    // appear only in the VoiceInput / Voice Anywhere STT selector).
    voiceInputOnly: true,
};
