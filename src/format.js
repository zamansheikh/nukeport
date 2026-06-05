'use strict';

/** Shared formatting helpers. */

function bytes(n) {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  n = Number(n);
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
}

function rate(n) {
  return bytes(n) + '/s';
}

function pct(n) {
  if (n == null || isNaN(n)) return '0%';
  return Math.round(n) + '%';
}

function duration(seconds) {
  seconds = Math.floor(seconds || 0);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h || d) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
}

function truncate(s, len) {
  s = String(s == null ? '' : s);
  if (s.length <= len) return s;
  if (len <= 1) return s.slice(0, len);
  return s.slice(0, len - 1) + '…';
}

function pad(s, len) {
  s = String(s == null ? '' : s);
  if (s.length >= len) return truncate(s, len);
  return s + ' '.repeat(len - s.length);
}

function clock(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

module.exports = { bytes, rate, pct, duration, truncate, pad, clock };
