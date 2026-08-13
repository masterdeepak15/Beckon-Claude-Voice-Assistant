'use strict';

const LABELS = {
  idle: 'Listening for wake word...',
  awake: "I'm listening...",
  processing: 'Working on it...',
  paused: 'Listening paused (Hold)'
};

const dot = document.getElementById('dot');
const text = document.getElementById('text');
const caption = document.getElementById('caption');

const STATE_TO_CLASS = { idle: '', awake: 'listening', processing: 'processing', paused: 'paused' };

window.popupAPI.onUpdate((data) => {
  const { state, name, captionText } = data;

  dot.className = STATE_TO_CLASS[state] !== undefined ? STATE_TO_CLASS[state] : '';
  text.textContent = state === 'awake'
    ? `${name || 'Assistant'} is listening...`
    : (LABELS[state] || state);

  caption.textContent = captionText || '';
});
