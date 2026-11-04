const themeToggle = document.getElementById('theme-toggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
function updateThemeButton() {
  const theme = document.documentElement.dataset.theme;
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  themeMeta.setAttribute('content', theme === 'dark' ? '#0c0b17' : '#f8f7fc');
}
updateThemeButton();
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('markdowner-theme', next); } catch (e) { /* storage optional */ }
  updateThemeButton();
});
