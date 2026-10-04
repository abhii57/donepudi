// Keep API calls on the deployed origin so Render's service name can change.
const API_BASE = '';

const state = {
  token: localStorage.token || '',
  user: (() => {
    try { return JSON.parse(localStorage.user || 'null'); }
    catch { return null; }
  })(),
  articles: []
};

const $ = selector =>
  document.querySelector(selector);

const toast = message => {
  const element = $('#toast');

  if (!element) return;

  element.textContent = message;
  element.classList.add('show');

  setTimeout(
    () =>
      element.classList.remove('show'),
    2800
  );
};

async function api(path, options = {}) {
  const response = await fetch(
    API_BASE + path,
    {
      ...options,
      headers: {
        'Content-Type':
          'application/json',
        ...(state.token
          ? {
              Authorization:
                `Bearer ${state.token}`
            }
          : {})
      }
    }
  );

  const data =
    await response.json().catch(
      () => ({})
    );

  if (!response.ok) {
    throw new Error(
      data.error ||
        'Something went wrong.'
    );
  }

  return data;
}

/*
 * ACCOUNT UI
 */
function updateAccount() {
  const account = $('#account');

  if (!account) return;

  if (!state.user) {
    document.body.classList.remove('admin-logged-in');
    account.innerHTML = `
      <div class="account-actions">
        <button
          class="ghost"
          onclick="openAuth('login')">
          Log in
        </button>

        <button
          class="primary"
          onclick="openAuth('signup')">
          Join Donepudi
        </button>
      </div>
    `;

    return;
  }

  const adminTools =
    state.user.role === 'admin'
      ? `
        ${
          $('#userModal')
            ? `
              <button
                class="ghost"
                onclick="showUsers()">
                Users
              </button>
            `
            : ''
        }

        ${
          $('#memberModal')
            ? `
              <button
                class="ghost"
                onclick="openMemberModal()">
                Members
              </button>
            `
            : ''
        }

      `
      : '';

  const createPostButton = $('#postModal')
    ? `<button class="primary" onclick="openCreatePost()">Create post +</button>`
    : '';

  document.body.classList.toggle(
    'admin-logged-in',
    state.user.role === 'admin'
  );

  account.innerHTML = `
    <div class="account-actions">

      <button class="user-chip" onclick="openProfile()" aria-label="Open your profile">
        <span class="avatar">
          ${state.user.profilePhoto
            ? `<img src="${state.user.profilePhoto}" alt="">`
            : state.user.name[0].toUpperCase()}
        </span>

        ${escapeHtml(
          state.user.name.split(' ')[0]
        )}
      </button>

      ${createPostButton}

      ${adminTools}

      <button
        class="ghost"
        onclick="logout()">
        Log out
      </button>

    </div>
  `;
}

/*
 * STORY
 */
function story(article) {
  const date =
    new Date(
      article.published_at
    ).toLocaleDateString(
      'en',
      {
        month: 'short',
        day: 'numeric'
      }
    );

  const adminControls =
    state.user?.role === 'admin'
      ? `
        <div class="admin-actions">
          <button
            onclick="editStory(${article.id})">
            Edit
          </button>

          <button
            class="delete"
            onclick="deleteStory(${article.id})">
            Delete
          </button>
        </div>
      `
      : '';

  return `
    <article class="story">

      <img
        class="cover"
        src="${
          article.image_url ||
          'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=85'
        }"
        alt=""
        onerror="this.style.display='none'">

      <div class="story-content">

        <div class="meta">
          ${escapeHtml(
            article.category.toUpperCase()
          )}
          ·
          ${date}

          ${
            article.is_breaking
              ? `
                <span class="breaking">
                  ● BREAKING
                </span>
              `
              : ''
          }
        </div>

        <h3>
          ${escapeHtml(article.title)}
        </h3>

        <p>
          ${escapeHtml(article.excerpt)}
        </p>

        <div class="story-footer">

          <span>
            By ${escapeHtml(article.author)}
          </span>

          <div class="actions">

            <button
              class="${
                article.liked
                  ? 'liked'
                  : ''
              }"
              onclick="like(${article.id})">
              ♥ ${article.likes}
            </button>

            <button
              onclick="comments(
                ${article.id},
                '${String(
                  article.title
                ).replaceAll(
                  "'",
                  "\\'"
                )}'
              )">
              ◌ ${article.comments}
            </button>

          </div>

        </div>

        ${adminControls}

      </div>
    </article>
  `;
}

/*
 * LOAD ARTICLES
 */
async function load() {
  const grid =
    $('#feedGrid');

  if (!grid) return;

  try {
    state.articles =
      await api(
        '/api/articles'
      );

    const highlights = state.articles.filter(article => Boolean(article.is_breaking));
    const announcementSection = $('#announcements');
    const highlightGrid = $('#highlightGrid');
    if (announcementSection && highlightGrid) {
      announcementSection.hidden = highlights.length === 0;
      highlightGrid.innerHTML = highlights.slice(0, 4).map(article => `
        <article class="highlight-post">
          ${article.image_url ? `<img src="${escapeHtml(article.image_url)}" alt="" onerror="this.hidden=true">` : ''}
          <div><span class="highlight-label">VILLAGE ANNOUNCEMENT</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt)}</p><small>By ${escapeHtml(article.author)}</small></div>
        </article>
      `).join('');
    }

    grid.innerHTML =
      state.articles
        .map(story)
        .join('');
  } catch {
    grid.innerHTML = `
      <p class="loading">
        Unable to reach the newsroom.
        Check your database connection.
      </p>
    `;
  }
}

/*
 * MEMBERS
 */
function memberCard(member) {
  return `
    <article class="member-card">

      ${
        member.photo_url
          ? `
            <img
              src="${member.photo_url}"
              alt="${escapeHtml(
                member.name
              )}"
              onerror="
                this.style.display='none'
              ">
          `
          : ''
      }

      <div>

        <h3>
          ${escapeHtml(member.name)}
        </h3>

        <p>
          ${escapeHtml(member.note)}
        </p>

      </div>

    </article>
  `;
}

async function loadMembers() {
  const grid =
    $('#memberGrid');

  if (!grid) return;

  try {
    const members =
      await api('/api/members');

    grid.innerHTML =
      members
        .map(memberCard)
        .join('') ||
      `
        <p class="loading">
          No members have been added yet.
        </p>
      `;
  } catch {
    grid.innerHTML = `
      <p class="loading">
        Unable to load members.
      </p>
    `;
  }
}

let selfieStream = null;
let googleClientId = '';
let googleScriptPromise = null;
let currentAuthMode = 'login';

function stopSelfieCamera() {
  if (selfieStream) {
    selfieStream.getTracks().forEach(track => track.stop());
    selfieStream = null;
  }
  const video = $('#selfieVideo');
  if (video) video.srcObject = null;
}

function showAuthMessage(message, kind = 'error') {
  const element = $('#authError');
  if (!element) {
    toast(message);
    return;
  }
  element.textContent = message;
  element.className = `auth-error ${kind}`;
  element.hidden = !message;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-google-identity]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('Google sign-in could not load.')), { once: true });
    if (window.google?.accounts?.id) resolve();
  });
  return googleScriptPromise;
}

async function initializeGoogleButton() {
  const slot = $('#googleButton');
  if (!slot) return;
  const status = $('#googleStatus');
  try {
    if (!googleClientId) {
      const config = await api('/api/auth/config');
      googleClientId = config.googleClientId || '';
    }
    if (!googleClientId) {
      status.textContent = 'Google sign-in is waiting for app configuration.';
      return;
    }
    await loadGoogleIdentityScript();
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    slot.replaceChildren();
    window.google.accounts.id.renderButton(slot, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: Math.min(350, Math.max(220, slot.clientWidth || 320))
    });
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message || 'Google sign-in is unavailable right now.';
  }
}

async function handleGoogleCredential(response) {
  const selfie = $('#selfieData')?.value || '';
  if (currentAuthMode === 'signup' && !selfie) {
    showAuthMessage('Take your live selfie first, then choose Google again.');
    return;
  }
  const button = $('#googleButton');
  if (button) button.classList.add('loading');
  showAuthMessage('Verifying your Google account…', 'success');
  try {
    const result = await api('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response?.credential, selfie: selfie || undefined })
    });
    acceptSignedInUser(result);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    if (button) button.classList.remove('loading');
  }
}

async function startSelfieCamera() {
  showAuthMessage('');
  if (!navigator.mediaDevices?.getUserMedia) {
    showAuthMessage('Camera access needs a secure HTTPS connection and a supported browser.');
    return;
  }
  try {
    stopSelfieCamera();
    const selfieData = $('#selfieData');
    if (selfieData) selfieData.value = '';
    selfieStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }
    });
    const video = $('#selfieVideo');
    video.srcObject = selfieStream;
    video.hidden = false;
    $('#selfiePreview').hidden = true;
    $('#selfiePlaceholder').hidden = true;
    $('#startSelfieButton').hidden = true;
    $('#captureSelfieButton').hidden = false;
    await video.play();
  } catch (error) {
    showAuthMessage(error.name === 'NotAllowedError'
      ? 'Allow camera access to take the required selfie.'
      : 'Could not open the camera. Check camera permission and try again.');
  }
}

function captureSelfie() {
  const video = $('#selfieVideo');
  const input = $('#selfieData');
  const canvas = $('#selfieCanvas');
  if (!video?.videoWidth || !input || !canvas) {
    showAuthMessage('Wait for the camera preview, then take your selfie.');
    return;
  }
  const crop = Math.min(video.videoWidth, video.videoHeight);
  const x = (video.videoWidth - crop) / 2;
  const y = (video.videoHeight - crop) / 2;
  canvas.width = 360;
  canvas.height = 360;
  canvas.getContext('2d').drawImage(video, x, y, crop, crop, 0, 0, 360, 360);
  input.value = canvas.toDataURL('image/jpeg', .74);
  $('#selfiePreview').src = input.value;
  $('#selfiePreview').hidden = false;
  video.hidden = true;
  $('#selfiePlaceholder').hidden = true;
  $('#captureSelfieButton').hidden = true;
  $('#startSelfieButton').hidden = false;
  $('#startSelfieButton').textContent = 'Retake selfie';
  stopSelfieCamera();
  showAuthMessage('Selfie captured. It will be saved with your profile.', 'success');
}

/*
 * AUTH MODAL
 */
function openAuth(mode, isAdmin = false) {
  const modal = $('#authModal');
  if (!modal) return;
  modal.showModal();
  renderAuth(mode, isAdmin);
}

$('#authModal')?.addEventListener('close', stopSelfieCamera);

function openAdminLogin() {
  openAuth('login', true);
}

function openProfile() {
  if (!state.user) {
    openAuth('login');
    return;
  }
  let modal = $('#profileModal');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'profileModal';
    modal.className = 'app-dialog profile-dialog';
    modal.innerHTML = '<button class="close" type="button" aria-label="Close">×</button><div id="profileContent"></div>';
    modal.querySelector('.close').onclick = () => modal.close();
    document.body.appendChild(modal);
  }
  const picture = state.user.profilePhoto
    ? `<img class="profile-photo-large" src="${escapeHtml(state.user.profilePhoto)}" alt="Profile selfie">`
    : `<span class="profile-photo-large profile-initial">${escapeHtml(state.user.name[0].toUpperCase())}</span>`;
  $('#profileContent').innerHTML = `
    <p class="eyebrow">YOUR DONEPUDI PROFILE</p>
    <div class="profile-summary">${picture}<div><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(state.user.email)}</p><span class="role-tag">${escapeHtml(state.user.role)}</span></div></div>
    <p class="profile-note">Your live selfie is saved as your profile photo.</p>
    <button class="primary" type="button" onclick="logout();this.closest('dialog').close()">Log out</button>`;
  modal.showModal();
}

function openCreatePost() {
  if (!state.user) {
    openAuth('login');
    return;
  }
  const form = $('#postForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  form.elements.category.value = 'Community';
  $('#postModalTitle').textContent = 'Create a post';
  $('#postSubmitLabel').textContent = 'Share with the village →';
  postModal.showModal();
}

function renderAuth(mode, isAdmin = false) {
  stopSelfieCamera();
  currentAuthMode = mode;
  const auth = $('#authContent');
  if (!auth) return;

  const googleBlock = isAdmin ? '' : `
    <div class="auth-divider"><span>or continue with</span></div>
    <div id="googleButton" class="google-button-slot"><button class="google-fallback" type="button" disabled><b>G</b> Continue with Google</button></div>
    <p id="googleStatus" class="auth-hint" role="status"></p>
  `;

  const errorBlock = '<p id="authError" class="auth-error" role="alert" aria-live="polite" hidden></p>';

  if (mode === 'signup') {
    auth.innerHTML = `
      <div class="auth-tabs">
        <button class="active" type="button" onclick="renderAuth('signup')">Create account</button>
        <button type="button" onclick="renderAuth('login')">Log in</button>
      </div>
      <form id="signupForm" onsubmit="submitSignup(event)">
        <h2>Create your Donepudi profile</h2>
        <p class="auth-intro">Join the village conversation. Take a live selfie to set your profile photo.</p>
        <input name="name" placeholder="Your name" autocomplete="name" required maxlength="80">
        <input name="email" type="email" placeholder="Email address" autocomplete="email" required maxlength="254">
        <div class="selfie-capture">
          <div class="selfie-view">
            <div id="selfiePlaceholder" class="selfie-placeholder"><span>◉</span><b>Live profile selfie</b><small>Your camera photo becomes your profile image.</small></div>
            <video id="selfieVideo" autoplay playsinline muted hidden></video>
            <img id="selfiePreview" alt="Your captured profile selfie" hidden>
            <canvas id="selfieCanvas" hidden></canvas>
          </div>
          <input id="selfieData" name="selfie" type="hidden">
          <div class="selfie-actions">
            <button id="startSelfieButton" class="ghost" type="button" onclick="startSelfieCamera()">Open camera</button>
            <button id="captureSelfieButton" class="primary" type="button" onclick="captureSelfie()" hidden>Take selfie</button>
          </div>
        </div>
        <input name="password" type="password" placeholder="Create password (8+ characters)" autocomplete="new-password" minlength="8" required>
        <input name="confirmPassword" type="password" placeholder="Confirm password" autocomplete="new-password" minlength="8" required>
        ${errorBlock}
        <button class="primary" id="signupButton" type="submit">Create account →</button>
        ${googleBlock}
      </form>
    `;
    initializeGoogleButton();
    return;
  }

  auth.innerHTML = `
    <div class="auth-tabs">
      <button class="active" type="button" onclick="renderAuth('login', ${isAdmin})">Log in</button>
      <button type="button" onclick="renderAuth('signup')">Create account</button>
    </div>
    <form id="loginForm" onsubmit="submitAuth(event, 'login', ${isAdmin})">
      <h2>${isAdmin ? 'Administrator sign in' : 'Welcome back'}</h2>
      <p class="auth-intro">${isAdmin ? 'Sign in to manage Donepudi community posts.' : 'Your village community is just a sign-in away.'}</p>
      <input name="email" type="email" placeholder="Email address" autocomplete="username" required>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      ${errorBlock}
      <button class="primary" type="submit">Log in →</button>
      ${googleBlock}
    </form>
  `;
  if (!isAdmin) initializeGoogleButton();
}

async function submitSignup(event) {
  event.preventDefault();
  const form = event.target;
  const button = $('#signupButton');
  const selfie = form.elements.selfie.value;
  if (!selfie) {
    showAuthMessage('Take a live selfie before creating your account.');
    return;
  }
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    showAuthMessage('Passwords do not match.');
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Creating account…'; }
  showAuthMessage('');
  try {
    const result = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        confirmPassword: form.elements.confirmPassword.value,
        selfie
      })
    });
    acceptSignedInUser(result);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Create account →'; }
  }
}

function acceptSignedInUser(result) {
  state.token = result.token;
  state.user = result.user;
  localStorage.token = result.token;
  localStorage.user = JSON.stringify(result.user);
  $('#authModal')?.close();
  updateAccount();
  Promise.allSettled([load(), loadMembers()]);
  toast(`Welcome, ${result.user.name.split(' ')[0]}!`);
}

/*
 * NORMAL LOGIN
 */
async function submitAuth(
  event,
  mode,
  isAdmin = false
) {
  event.preventDefault();

  try {
    const data =
      Object.fromEntries(
        new FormData(
          event.target
        )
      );

    const response =
      await api(
        '/api/auth/' +
          (mode === 'login'
            ? 'login'
            : 'signup'),
        {
          method: 'POST',
          body:
            JSON.stringify(data)
        }
      );

    if (isAdmin && response.user.role !== 'admin') {
      throw new Error('This account does not have administrator access.');
    }

    acceptSignedInUser(response);

    if (mode === 'login' && response.user.role === 'admin') {
      window.location.href = 'index.html';
      return;
    }
  } catch (error) {
    showAuthMessage(error.message);
  }
}

/*
 * LOGOUT
 */
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  state.token = '';
  state.user = null;

  updateAccount();

  load();

  toast(
    'You are logged out.'
  );
}

async function restoreSession() {
  if (state.token) {
    try {
      const session = await api('/api/auth/me');
      state.user = session.user;
      localStorage.user = JSON.stringify(session.user);
    } catch {
      state.token = '';
      state.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  } else if (state.user) {
    state.user = null;
    localStorage.removeItem('user');
  }

  updateAccount();
  await Promise.allSettled([load(), loadMembers()]);
}

/*
 * LIKE
 */
async function like(id) {
  if (!state.user) {
    return openAuth(
      'login'
    );
  }

  try {
    await api(
      `/api/articles/${id}/like`,
      {
        method: 'POST'
      }
    );

    load();
  } catch (error) {
    toast(
      error.message
    );
  }
}

/*
 * COMMENTS
 */
async function comments(
  id,
  title
) {
  if (!state.user) {
    return openAuth(
      'login'
    );
  }

  const content =
    prompt(
      `Comment on “${title}”`
    );

  if (!content) return;

  try {
    await api(
      `/api/articles/${id}/comments`,
      {
        method: 'POST',
        body:
          JSON.stringify({
            content
          })
      }
    );

    toast(
      'Comment added.'
    );

    load();
  } catch (error) {
    toast(
      error.message
    );
  }
}

/*
 * IMAGE DATA
 */
async function imageData(
  file
) {
  if (!file) return null;

  if (
    !file.type.startsWith(
      'image/'
    )
  ) {
    throw new Error(
      'Choose an image file.'
    );
  }

  if (
    file.size >
    5 * 1024 * 1024
  ) {
    throw new Error(
      'Image must be 5 MB or smaller.'
    );
  }

  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload =
        () =>
          resolve(
            reader.result
          );

      reader.onerror =
        () =>
          reject(
            new Error(
              'Unable to read the image.'
            )
          );

      reader.readAsDataURL(
        file
      );
    }
  );
}

/*
 * MEMBER MODAL
 */
function openMemberModal() {
  const form =
    $('#memberForm');

  if (!form) return;

  form.reset();

  memberModal.showModal();
}

if ($('#memberForm')) {
  $('#memberForm').onsubmit =
    async event => {
      event.preventDefault();

      try {
        const form =
          event.target;

        const photo =
          await imageData(
            form.photoFile
              .files[0]
          );

        await api(
          '/api/members',
          {
            method: 'POST',
            body:
              JSON.stringify({
                name:
                  form.name.value,

                note:
                  form.note.value,

                photoUrl:
                  photo ||
                  form.photoUrl
                    .value ||
                  null
              })
          }
        );

        memberModal.close();

        form.reset();

        loadMembers();

        toast(
          'Member added.'
        );
      } catch (error) {
        toast(
          error.message
        );
      }
    };
}

/*
 * HELPLINE
 */
if ($('#helpForm')) {
  $('#helpForm').onsubmit =
    async event => {
      event.preventDefault();

      try {
        const form =
          event.target;

        await api(
          '/api/help-requests',
          {
            method: 'POST',
            body:
              JSON.stringify(
                Object.fromEntries(
                  new FormData(
                    form
                  )
                )
              )
          }
        );

        form.reset();

        toast(
          'Your help request has been sent.'
        );
      } catch (error) {
        toast(
          error.message
        );
      }
    };
}

/*
 * EDIT STORY
 */
function editStory(id) {
  const article =
    state.articles.find(
      item =>
        item.id === id
    );

  if (!article) return;

  const form =
    $('#postForm');

  form.reset();

  form.elements.id.value =
    article.id;

  form.title.value =
    article.title;

  form.excerpt.value =
    article.excerpt;

  form.category.value =
    article.category;

  form.imageUrl.value =
    article.image_url?.startsWith(
      'data:'
    )
      ? ''
      : article.image_url ||
        '';

  form.isBreaking.checked =
    !!article.is_breaking;

  $('#postModalTitle')
    .textContent =
    'Edit story';

  $('#postSubmitLabel')
    .textContent =
    'Save changes →';

  postModal.showModal();
}

/*
 * DELETE STORY
 */
async function deleteStory(id) {
  const article =
    state.articles.find(
      item =>
        item.id === id
    );

  if (
    !article ||
    !confirm(
      `Delete “${article.title}”? This cannot be undone.`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/articles/${id}`,
      {
        method: 'DELETE'
      }
    );

    toast(
      'Story deleted.'
    );

    load();
  } catch (error) {
    toast(
      error.message
    );
  }
}

/*
 * ESCAPE HTML
 */
const escapeHtml =
  value =>
    String(value).replace(
      /[&<>'"]/g,
      character =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[character])
    );

/*
 * ADMIN USERS
 */
async function showUsers() {
  try {
    const users =
      await api(
        '/api/admin/users'
      );

    $('#userContent').innerHTML = `
      <p class="eyebrow">
        ADMINISTRATION
      </p>

      <h2>
        Registered users
      </h2>

      <p class="demo">
        ${users.length}
        account${
          users.length === 1
            ? ''
            : 's'
        }
        registered
      </p>

      <div class="user-list">

        ${users
          .map(
            user => `
              <div class="user-row">

                <div>

                  <strong>
                    ${escapeHtml(
                      user.name
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      user.email
                    )}
                  </small>

                  ${
                    user.mobile
                      ? `
                        <small>
                          ${escapeHtml(
                            user.mobile
                          )}
                        </small>
                      `
                      : ''
                  }

                </div>

                <span class="role-tag">
                  ${escapeHtml(
                    user.role
                  )}
                </span>

              </div>
            `
          )
          .join('')}

      </div>
    `;

    userModal.showModal();
  } catch (error) {
    toast(
      error.message
    );
  }
}

/*
 * POST / EDIT ARTICLE
 */
if ($('#postForm')) {
  $('#postForm').onsubmit =
    async event => {
      event.preventDefault();

      try {
        const form =
          event.target;

        const data =
          Object.fromEntries(
            new FormData(form)
          );

        delete data.imageFile;
        delete data.id;

        const uploaded =
          await imageData(
            form.imageFile
              .files[0]
          );

        if (uploaded) {
          data.imageUrl =
            uploaded;
        } else if (
          !data.imageUrl
        ) {
          delete data.imageUrl;
        }

        const postTitle = form.title.value.trim();
        const postExcerpt = form.excerpt.value.trim();
        data.title = postTitle || postExcerpt.slice(0, 70);
        data.excerpt = postExcerpt;
        data.isBreaking =
          state.user?.role === 'admin' && !!form.isBreaking?.checked;

        const editing =
          !!form.elements.id.value;

        await api(
          editing
            ? `/api/articles/${form.elements.id.value}`
            : '/api/articles',
          {
            method:
              editing
                ? 'PUT'
                : 'POST',

            body:
              JSON.stringify(
                data
              )
          }
        );

        postModal.close();

        form.reset();

        $('#postModalTitle').textContent = 'Create a post';

        $('#postSubmitLabel')
          .textContent =
          'Share with the village →';

        load();

        toast(
          editing
            ? 'Story updated.'
            : 'Your post is live in the village feed.'
        );
      } catch (error) {
        toast(
          error.message
        );
      }
    };
}

/*
 * FILTERS
 */
document
  .querySelectorAll(
    '.filters button'
  )
  .forEach(button => {
    button.onclick =
      () => {
        const active =
          document.querySelector(
            '.filters .active'
          );

        if (active) {
          active.classList.remove(
            'active'
          );
        }

        button.classList.add(
          'active'
        );

        const name =
          button.textContent;

        $('#feedGrid').innerHTML =
          state.articles
            .filter(
              article =>
                name === 'All' ||
                article.category ===
                  name
            )
            .map(story)
            .join('') ||
          `
            <p class="loading">
              No stories in this section yet.
            </p>
          `;
      };
  });

/*
 * MOBILE MENU
 */
function toggleMobileMenu() {
  const menu =
    $('#mobileMenu');

  const button =
    document.querySelector(
      '.mobile-menu-btn'
    );

  if (!menu) return;

  const open =
    menu.classList.toggle(
      'open'
    );

  if (button) {
    button.setAttribute(
      'aria-expanded',
      String(open)
    );
  }
}

function closeMobileMenu() {
  const menu =
    $('#mobileMenu');

  const button =
    document.querySelector(
      '.mobile-menu-btn'
    );

  if (menu) {
    menu.classList.remove(
      'open'
    );
  }

  if (button) {
    button.setAttribute(
      'aria-expanded',
      'false'
    );
  }
}

document.addEventListener(
  'click',
  event => {
    const menu =
      $('#mobileMenu');

    const button =
      document.querySelector(
        '.mobile-menu-btn'
      );

    if (
      menu &&
      menu.classList.contains(
        'open'
      ) &&
      !menu.contains(
        event.target
      ) &&
      event.target !== button
    ) {
      closeMobileMenu();
    }
  }
);

/*
 * INITIAL LOAD
 */
restoreSession();

setInterval(
  load,
  30000
);
