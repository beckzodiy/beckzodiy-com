const tokenKey = 'beckzodiy_admin_key'
const $ = (selector, root = document) => root.querySelector(selector)
const adminToken = () => localStorage.getItem(tokenKey) || ''
let lastEditorRange = null

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.hasAttribute('data-admin-page')) await loadAdmin()
  else if (location.pathname === '/') await loadIndex()
})

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (adminToken()) headers.set('authorization', `Bearer ${adminToken()}`)
  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return response.status === 204 ? null : response.json()
}

async function loadIndex() {
  const list = $('[data-list]')
  const form = $('[data-search]')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const query = new FormData(event.currentTarget).get('q').trim()
    if (query.length < 2) return
    history.replaceState(null, '', `/?q=${encodeURIComponent(query)}`)
    await performPublicSearch(query)
  })
  const initialQuery = new URLSearchParams(location.search).get('q')?.trim()
  if (initialQuery) { form.elements.q.value = initialQuery; await performPublicSearch(initialQuery) }
  else list.innerHTML = ''
}

async function performPublicSearch(query) {
  const list = $('[data-list]')
  $('[data-results]').hidden = false
  document.body.classList.add('has-results')
  list.innerHTML = '<p class="muted">Searching…</p>'
  try {
    const { articles } = await api(`/api/search?q=${encodeURIComponent(query)}`)
    list.innerHTML = articles.length ? `<p class="search-summary">Results from beckzodiy.com</p>${renderArticleLinks(articles)}` : `<p class="muted">No articles found for “${escapeText(query)}”.</p>`
  } catch (error) { list.innerHTML = `<p class="muted">${escapeText(error.message)}</p>` }
}

function renderArticleLinks(articles) {
  return articles.map(a => `<a href="/${encodeURIComponent(a.slug)}"><h2>${escapeText(a.title)}</h2><p class="article-meta">${escapeText(a.author || 'Anonymous')} · ${formatDate(a.created_at)}</p></a>`).join('')
}

async function loadAdmin() {
  if (!adminToken()) return showLogin()
  try { await api('/api/admin/session') }
  catch { localStorage.removeItem(tokenKey); return showLogin('Incorrect admin key.') }
  $('[data-logout]').hidden = false
  $('[data-logout]').onclick = () => { localStorage.removeItem(tokenKey); location.reload() }
  const write = $('[data-new]'); write.hidden = false; write.onclick = () => openEditor()
  $('[data-admin-search]').addEventListener('submit', async event => {
    event.preventDefault()
    await loadAdminArticles(new FormData(event.currentTarget).get('q').trim())
  })
  $('[data-admin-search] input').addEventListener('search', event => { if (!event.currentTarget.value) loadAdminArticles() })
  await loadAdminArticles()
}

async function loadAdminArticles(query = '') {
  const list = $('[data-list]')
  try {
    const { articles } = await api(query.length >= 2 ? `/api/search?q=${encodeURIComponent(query)}` : '/api/articles')
    list.innerHTML = articles.length ? articles.map(a => `<div class="admin-row"><a href="/${encodeURIComponent(a.slug)}"><h2>${escapeText(a.title)}</h2><p class="article-meta">${escapeText(a.author || 'Anonymous')} · ${formatDate(a.created_at)}</p></a><div><button data-edit="${escapeText(a.slug)}">Edit</button><button class="danger" data-delete="${escapeText(a.slug)}">Delete</button></div></div>`).join('') : '<p class="muted">Nothing published yet.</p>'
    list.querySelectorAll('[data-edit]').forEach(button => button.onclick = async () => { const { article } = await api(`/api/articles/${encodeURIComponent(button.dataset.edit)}`); openEditor(article) })
    list.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { if (!confirm('Delete this article permanently?')) return; try { await api(`/api/articles/${encodeURIComponent(button.dataset.delete)}`, { method:'DELETE' }); await loadAdminArticles() } catch (error) { alert(error.message) } })
  } catch (error) { list.innerHTML = `<p class="muted">${escapeText(error.message)}</p>` }
}

function showLogin(message = '') {
  const dialog = document.createElement('dialog')
  dialog.innerHTML = `<form method="dialog"><h2>Admin access</h2>${message ? `<p class="login-error">${escapeText(message)}</p>` : ''}<label>Secret key<input name="key" type="password" autocomplete="current-password" placeholder="ADMIN_SECRET_KEY" required></label><div class="dialog-actions"><a class="button-link" href="/">Cancel</a><button class="primary" value="login">Log in</button></div></form>`
  document.body.append(dialog)
  $('form', dialog).addEventListener('submit', async e => {
    e.preventDefault()
    const key = new FormData(e.currentTarget).get('key').trim()
    localStorage.setItem(tokenKey, key)
    try { await api('/api/admin/session'); dialog.close(); await loadAdmin() }
    catch { localStorage.removeItem(tokenKey); dialog.remove(); showLogin('Incorrect admin key.') }
  })
  dialog.showModal(); $('input', dialog).focus()
}

function openEditor(article = null) {
  document.title = article ? `Edit ${article.title}` : 'New article'
  document.body.innerHTML = `<header class="site-head"><a href="/">beckzodiy.com</a><div class="head-actions"><button class="theme-toggle" data-editor-theme aria-label="Switch color theme">${document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'}</button><button class="quiet" data-exit>Exit</button></div></header><main class="editor"><div class="toolbar"><button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="formatBlock" data-value="h2" title="Heading">H2</button><button type="button" data-quote title="Toggle quote">“</button><button type="button" data-link>Link</button><label class="color-tool" title="Text color"><span>A</span><input type="color" data-color value="#2b6cb0"></label><button type="button" data-image>Image</button></div><div class="editor-title" contenteditable="true" data-placeholder="Title"></div><div class="editor-author" contenteditable="true" data-placeholder="Your name"></div><div class="editor-body story" contenteditable="true" data-placeholder="Your story…"></div><footer class="editor-footer"><button class="primary" data-publish>${article ? 'Save changes' : 'Publish'}</button><span class="status" data-status></span></footer></main>`
  $('.editor-title').textContent = article?.title || ''
  $('.editor-author').textContent = article?.author || ''
  $('.editor-body').innerHTML = article?.content_html || ''
  $('[data-exit]').onclick = () => location.href = '/admin1225'
  $('[data-editor-theme]').onclick = event => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme
    localStorage.setItem('beckzodiy_theme', theme); event.currentTarget.textContent = theme === 'dark' ? '☀' : '☾'
  }
  $('.toolbar').addEventListener('mousedown', event => { if (!event.target.closest('input')) event.preventDefault() })
  document.querySelectorAll('[data-cmd]').forEach(button => button.onclick = () => runCommand(button.dataset.cmd, button.dataset.value || null))
  $('[data-quote]').onclick = toggleQuote
  $('[data-link]').onclick = addLink
  $('[data-color]').addEventListener('input', event => runCommand('foreColor', event.target.value))
  $('[data-image]').onclick = chooseImage
  $('[data-publish]').onclick = () => saveArticle(article)
  setupImageDrops($('.editor-body'))
  document.addEventListener('selectionchange', rememberEditorSelection)
  $('.editor-title').focus()
}

async function saveArticle(existing) {
  const status = $('[data-status]'); status.textContent = 'Saving…'
  const payload = { title: $('.editor-title').innerText.trim(), author: $('.editor-author').innerText.trim(), content_html: cleanEditorHtml($('.editor-body').innerHTML), slug: existing?.slug }
  try {
    const path = existing ? `/api/articles/${encodeURIComponent(existing.slug)}` : '/api/articles'
    const { article } = await api(path, { method: existing ? 'PUT' : 'POST', body:JSON.stringify(payload) })
    location.href = `/${article.slug}`
  } catch (error) { status.textContent = error.message }
}

function chooseImage() {
  const selection = saveSelection()
  const input = Object.assign(document.createElement('input'), { type:'file', accept:'image/*' })
  input.onchange = () => input.files[0] && uploadImage(input.files[0], selection)
  input.click()
}

function setupImageDrops(editor) {
  editor.addEventListener('dragover', e => { e.preventDefault(); editor.classList.add('drop-active') })
  editor.addEventListener('dragleave', () => editor.classList.remove('drop-active'))
  editor.addEventListener('drop', e => { e.preventDefault(); editor.classList.remove('drop-active'); const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (file) uploadImage(file) })
  editor.addEventListener('paste', e => { const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (file) { e.preventDefault(); uploadImage(file) } })
}

async function uploadImage(file, savedRange = null) {
  const status = $('[data-status]'); status.textContent = `Uploading ${file.name || 'image'}…`
  const selection = savedRange || saveSelection()
  const description = prompt('Describe this image for accessibility (alt text):', '') ?? ''
  const caption = prompt('Visible caption (optional):', '') ?? ''
  const form = new FormData(); form.append('file', file)
  try {
    const { url } = await api('/api/upload', { method:'POST', body:form })
    restoreSelection(selection)
    $('.editor-body').focus()
    const image = `<figure><img src="${escapeAttribute(url)}" alt="${escapeAttribute(description)}">${caption ? `<figcaption>${escapeText(caption)}</figcaption>` : ''}</figure><p><br></p>`
    document.execCommand('insertHTML', false, image)
    status.textContent = 'Image uploaded'
  } catch (error) { status.textContent = error.message }
}

function runCommand(command, value = null) {
  restoreSelection(saveSelection())
  document.execCommand(command, false, value)
}

function toggleQuote() {
  const selection = window.getSelection()
  const node = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection?.anchorNode
  const quote = node?.closest?.('blockquote')
  runCommand('formatBlock', quote ? 'p' : 'blockquote')
}

function addLink() {
  const selection = saveSelection()
  const raw = prompt('Paste a web address:')
  if (!raw) return
  const url = normalizeUrl(raw)
  if (!url) return alert('Please enter a valid http://, https://, mailto:, or tel: link.')
  restoreSelection(selection)
  const selectedText = window.getSelection()?.toString()
  if (selectedText) {
    document.execCommand('createLink', false, url)
    const anchor = window.getSelection()?.anchorNode?.parentElement?.closest('a')
    if (anchor) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer' }
  } else {
    document.execCommand('insertHTML', false, `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeText(url)}</a>`)
  }
}

function normalizeUrl(value) {
  const input = value.trim()
  if (/^(mailto:|tel:)/i.test(input)) return input
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) ? url.href : '' } catch { return '' }
}

function saveSelection() {
  const selection = window.getSelection()
  return selection?.rangeCount && $('.editor-body').contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : lastEditorRange
}

function restoreSelection(range) {
  if (!range) { $('.editor-body').focus(); return }
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
}

function rememberEditorSelection() {
  const selection = window.getSelection()
  if (selection?.rangeCount && $('.editor-body')?.contains(selection.anchorNode)) lastEditorRange = selection.getRangeAt(0).cloneRange()
}

function cleanEditorHtml(html) {
  const template = document.createElement('template'); template.innerHTML = html
  template.content.querySelectorAll('script,style,iframe,object,embed').forEach(el => el.remove())
  template.content.querySelectorAll('*').forEach(el => [...el.attributes].forEach(attr => { if (attr.name.startsWith('on') || attr.name === 'style') el.removeAttribute(attr.name); if ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value)) el.removeAttribute(attr.name) }))
  return template.innerHTML
}

function escapeText(value) { const span = document.createElement('span'); span.textContent = value ?? ''; return span.innerHTML }
function escapeAttribute(value) { return escapeText(value).replace(/`/g, '&#96;') }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { year:'numeric', month:'short', day:'numeric' }).format(new Date(value)) }
