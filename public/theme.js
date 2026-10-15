(() => {
  const key = 'beckzodiy_theme'
  const saved = localStorage.getItem(key)
  const preferred = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const apply = theme => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = theme === 'dark' ? '☀' : '☾'
      button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
    })
  }
  apply(saved || preferred)
  addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme)
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(key, theme)
      apply(theme)
    }))
  })
})()
