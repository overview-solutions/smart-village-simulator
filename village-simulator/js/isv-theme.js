/**
 * ISV Knowledge Base — theme toggle (Locus sim default: dark)
 * Persists to localStorage key "locus-theme"
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'locus-theme';
  var DEFAULT_THEME = 'dark';

  function normalize(theme) {
    return theme === 'dark' || theme === 'light' ? theme : DEFAULT_THEME;
  }

  function getTheme() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return DEFAULT_THEME;
    }
  }

  function applyTheme(theme) {
    var t = normalize(theme);
    var root = document.documentElement;
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    updateToggleLabels(t);
    syncIframes(t);
  }

  function setTheme(theme) {
    var t = normalize(theme);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch (e) { /* private browsing */ }
    applyTheme(t);
  }

  function toggleTheme() {
    setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  function updateToggleLabels(theme) {
    var isDark = theme === 'dark';
    document.querySelectorAll('[data-isv-theme-toggle]').forEach(function (btn) {
      var label = btn.querySelector('.theme-toggle-label');
      if (label) {
        label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
      }
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function syncIframes(theme) {
    document.querySelectorAll('iframe').forEach(function (frame) {
      try {
        if (frame.contentDocument && frame.contentDocument.documentElement) {
          frame.contentDocument.documentElement.setAttribute('data-theme', theme);
          frame.contentDocument.documentElement.style.colorScheme = theme;
        }
      } catch (e) { /* cross-origin */ }
    });
  }

  function syncFrame(frame) {
    if (!frame) return;
    function apply() {
      var theme = getTheme();
      try {
        if (frame.contentDocument && frame.contentDocument.documentElement) {
          frame.contentDocument.documentElement.setAttribute('data-theme', theme);
          frame.contentDocument.documentElement.style.colorScheme = theme;
        }
      } catch (e) { /* cross-origin */ }
    }
    apply();
    if (!frame.dataset.isvThemeSync) {
      frame.dataset.isvThemeSync = '1';
      frame.addEventListener('load', apply);
    }
  }

  function initToggleButtons() {
    document.querySelectorAll('[data-isv-theme-toggle]').forEach(function (btn) {
      if (btn.dataset.isvThemeBound) return;
      btn.dataset.isvThemeBound = '1';
      btn.addEventListener('click', function () {
        toggleTheme();
      });
    });
    updateToggleLabels(getTheme());
  }

  /* Apply before paint */
  applyTheme(getTheme());

  global.ISVTheme = {
    get: getTheme,
    set: setTheme,
    toggle: toggleTheme,
    initToggleButtons: initToggleButtons,
    syncFrame: syncFrame,
    syncIframes: function () { syncIframes(getTheme()); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggleButtons);
  } else {
    initToggleButtons();
  }

  global.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY && e.newValue) {
      applyTheme(e.newValue);
    }
  });
})(typeof window !== 'undefined' ? window : this);
