'use strict';

const $ = (sel) => document.querySelector(sel);

function nextUrl() {
  const raw = new URLSearchParams(location.search).get('next') || '/';
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

async function init() {
  try {
    const res = await fetch('/api/session', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (data.authenticated) {
      location.replace(nextUrl());
      return;
    }
  } catch { /* ignore */ }
  $('#loginUser').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#loginError');
  const button = $('#loginSubmit');
  error.classList.add('hidden');
  button.disabled = true;
  button.textContent = '正在登录…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: $('#loginUser').value.trim(),
        password: $('#loginPass').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    location.replace(nextUrl());
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('hidden');
    button.disabled = false;
    button.textContent = '登录';
  }
});

document.addEventListener('DOMContentLoaded', init);
