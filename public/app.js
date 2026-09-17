const API_BASE = 'https://donepudi.onrender.com';

const MSG91_WIDGET_ID = '36696f63576e373530373136';

const MSG91_WIDGET_TOKEN =
  '571343TCANRG8SAyJk6aa8c21fP1';

const DONEPUDI_OTP_FIX_VERSION = '2026-09-17-definitive-1';
console.log('Donepudi OTP build:', DONEPUDI_OTP_FIX_VERSION);

const state = {
  token: localStorage.token || '',
  user: JSON.parse(
    localStorage.user || 'null'
  ),
  articles: [],
  otp: {
    initialized: false,
    requested: false,
    verified: false,
    accessToken: '',
    mobile: '',
    reqId: '',
    loading: false
  }
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

        ${
          $('#postModal')
            ? `
              <button
                class="primary"
                onclick="postModal.showModal()">
                Publish +
              </button>
            `
            : ''
        }
      `
      : '';

  account.innerHTML = `
    <div class="account-actions">

      <div class="user-chip">
        <span class="avatar">
          ${state.user.name[0].toUpperCase()}
        </span>

        ${escapeHtml(
          state.user.name.split(' ')[0]
        )}
      </div>

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

/*
 * MSG91 SCRIPT
 */
function loadMSG91Widget() {
  return new Promise(
    (resolve, reject) => {
      if (
        typeof window.initSendOTP ===
        'function'
      ) {
        resolve();
        return;
      }

      const existing =
        document.querySelector(
          'script[data-msg91-widget]'
        );

      if (existing) {
        const timer =
          setInterval(() => {
            if (
              typeof window.initSendOTP ===
              'function'
            ) {
              clearInterval(timer);
              resolve();
            }
          }, 100);

        setTimeout(() => {
          clearInterval(timer);
          reject(
            new Error(
              'MSG91 widget could not be loaded.'
            )
          );
        }, 10000);

        return;
      }

      const script =
        document.createElement(
          'script'
        );

      script.src =
        'https://verify.msg91.com/otp-provider.js';

      script.async = true;

      script.dataset.msg91Widget =
        'true';

      script.onload = () => {
        if (
          typeof window.initSendOTP ===
          'function'
        ) {
          resolve();
        } else {
          reject(
            new Error(
              'MSG91 OTP widget is unavailable.'
            )
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error(
            'Unable to load MSG91 OTP service.'
          )
        );
      };

      document.head.appendChild(
        script
      );
    }
  );
}

/*
 * INITIALIZE MSG91
 */
async function initializeMSG91() {
  if (
    state.otp.initialized
  ) {
    return;
  }

  if (
    !MSG91_WIDGET_TOKEN ||
    MSG91_WIDGET_TOKEN ===
      'PASTE_YOUR_MSG91_WIDGET_TOKEN_HERE'
  ) {
    throw new Error(
      'MSG91 widget token is missing in app.js.'
    );
  }

  await loadMSG91Widget();

  const configuration = {
    widgetId:
      MSG91_WIDGET_ID,

    tokenAuth:
      MSG91_WIDGET_TOKEN,

    identifier: '',

    exposeMethods: true,

    success: data => {
      console.log(
        'MSG91 success:',
        data
      );
    },

    failure: error => {
      console.log(
        'MSG91 failure:',
        error
      );
    }
  };

  window.initSendOTP(
    configuration
  );

  state.otp.initialized =
    true;
}

/*
 * RESET OTP STATE
 */
function resetOTPState() {
  state.otp = {
    initialized: state.otp.initialized,
    requested: false,
    verified: false,
    accessToken: '',
    mobile: '',
    reqId: '',
    loading: false
  };
}

/*
 * AUTH MODAL
 */
function openAuth(
  mode,
  isAdmin = false
) {
  const modal =
    $('#authModal');

  if (!modal) return;

  resetOTPState();

  modal.showModal();

  renderAuth(
    mode,
    isAdmin
  );
}

function openAdminLogin() {
  openAuth(
    'login',
    true
  );
}

/*
 * RENDER AUTH
 */
function renderAuth(
  mode,
  isAdmin = false
) {
  const auth =
    $('#authContent');

  if (!auth) return;

  if (mode === 'signup') {
    auth.innerHTML = `
      <div class="auth-tabs">

        <button
          class="active"
          onclick="renderAuth('signup')">
          Create account
        </button>

        <button
          onclick="renderAuth('login')">
          Log in
        </button>

      </div>

      <form
        id="signupForm"
        onsubmit="submitSignup(event)">

        <h2>
          Join the conversation
        </h2>

        <input
          name="name"
          placeholder="Your name"
          autocomplete="name"
          required>

        <input
          name="email"
          type="email"
          placeholder="Email address"
          autocomplete="email"
          required>

        <div
          style="
            display:flex;
            gap:8px;
            align-items:stretch;
          ">

          <input
            name="mobile"
            id="signupMobile"
            type="tel"
            inputmode="numeric"
            placeholder="Mobile number"
            autocomplete="tel"
            maxlength="10"
            required
            style="flex:1;">

          <button
            type="button"
            class="ghost"
            id="sendOtpButton"
            onclick="sendSignupOTP()">
            Send OTP
          </button>

        </div>

        <div
          id="otpSection"
          style="display:none;">

          <input
            id="signupOtp"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Enter OTP"
            maxlength="6">

          <div
            style="
              display:flex;
              gap:8px;
              margin-top:8px;
            ">

            <button
              type="button"
              class="primary"
              id="verifyOtpButton"
              onclick="verifySignupOTP()">
              Verify OTP
            </button>

            <button
              type="button"
              class="ghost"
              id="resendOtpButton"
              onclick="resendSignupOTP()">
              Resend OTP
            </button>

          </div>

          <p
            id="otpStatus"
            class="demo">
            OTP sent. Enter the OTP
            received on your mobile.
          </p>

        </div>

        <input
          name="password"
          type="password"
          placeholder="Password"
          autocomplete="new-password"
          minlength="6"
          required>

        <input
          name="confirmPassword"
          type="password"
          placeholder="Confirm password"
          autocomplete="new-password"
          minlength="6"
          required>

        <button
          class="primary"
          id="signupButton"
          type="submit">
          Create account →
        </button>

      </form>
    `;

    return;
  }

  auth.innerHTML = `
    <div class="auth-tabs">

      <button
        class="active"
        onclick="renderAuth(
          'login',
          ${isAdmin}
        )">
        Log in
      </button>

      <button
        onclick="renderAuth('signup')">
        Create account
      </button>

    </div>

    <form
      onsubmit="
        submitAuth(
          event,
          'login'
        )
      ">

      <h2>
        ${
          isAdmin
            ? 'Administrator sign in'
            : 'Welcome back'
        }
      </h2>

      <input
        name="email"
        type="email"
        placeholder="Email address"
        autocomplete="email"
        required>

      <input
        name="password"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        required>

      <button
        class="primary"
        type="submit">
        Log in →
      </button>

    </form>
  `;
}

/*
 * NORMALIZE MOBILE
 */
function normalizeMobile(
  value
) {
  const digits =
    String(value || '')
      .replace(/\D/g, '');

  if (
    digits.length === 10
  ) {
    return '91' + digits;
  }

  if (
    digits.length === 12 &&
    digits.startsWith('91')
  ) {
    return digits;
  }

  return null;
}

/*
 * SEND OTP
 */
async function sendSignupOTP() {
  if (state.otp.loading) {
    return;
  }

  const form =
    $('#signupForm');

  if (!form) return;

  const name =
    form.elements.name.value.trim();

  const email =
    form.elements.email.value.trim();

  const mobile =
    form.elements.mobile.value.trim();

  const password =
    form.elements.password.value;

  const confirmPassword =
    form.elements.confirmPassword.value;

  if (!name) {
    toast(
      'Enter your name.'
    );
    return;
  }

  if (!email) {
    toast(
      'Enter your email.'
    );
    return;
  }

  const normalizedMobile =
    normalizeMobile(mobile);

  if (!normalizedMobile) {
    toast(
      'Enter a valid 10-digit Indian mobile number.'
    );
    return;
  }

  if (
    password.length < 6
  ) {
    toast(
      'Password must be at least 6 characters.'
    );
    return;
  }

  if (
    password !== confirmPassword
  ) {
    toast(
      'Passwords do not match.'
    );
    return;
  }

  state.otp.loading =
    true;

  const button =
    $('#sendOtpButton');

  if (button) {
    button.disabled = true;
    button.textContent =
      'Sending...';
  }

  try {
    /*
     * First make sure the email/mobile
     * aren't already registered.
     */
    await api(
      '/api/auth/check-signup',
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          mobile,
          password,
          confirmPassword
        })
      }
    );

    await initializeMSG91();

    /*
     * MSG91 requires country code
     * without the + sign.
     */
    window.sendOtp(
      normalizedMobile,

      data => {
        const reqId =
          data?.reqId ||
          data?.reqID ||
          data?.requestId ||
          data?.data?.reqId ||
          data?.data?.reqID ||
          data?.data?.requestId ||
          '';

        // MSG91 Web SDK custom UI does not require the browser
        // app to receive/store reqId from the sendOtp callback.
        // The SDK keeps the active OTP request internally.
        if (reqId) {
          state.otp.reqId = reqId;
        }

        state.otp.requested =
          true;

        state.otp.verified =
          false;

        state.otp.mobile =
          normalizedMobile;

        const section =
          $('#otpSection');

        if (section) {
          section.style.display =
            'block';
        }

        const status =
          $('#otpStatus');

        if (status) {
          status.textContent =
            'OTP sent. Enter the OTP received on your mobile.';
        }

        toast(
          'OTP sent successfully.'
        );
      },

      error => {
        console.error(
          'OTP send error:',
          error
        );

        toast(
          'Unable to send OTP. Please try again.'
        );
      }
    );
  } catch (error) {
    toast(
      error.message
    );
  } finally {
    state.otp.loading =
      false;

    if (button) {
      button.disabled =
        false;

      button.textContent =
        'Send OTP';
    }
  }
}

/*
 * VERIFY OTP
 */
async function verifySignupOTP() {
  const otpInput =
    $('#signupOtp');

  if (!otpInput) return;

  const otp =
    otpInput.value.trim();

  if (!state.otp.requested) {
    toast(
      'Please send a new OTP first.'
    );
    return;
  }

  if (!/^\d{4,8}$/.test(otp)) {
    toast(
      'Enter the OTP you received.'
    );
    return;
  }

  const button =
    $('#verifyOtpButton');

  if (button) {
    button.disabled = true;
    button.textContent =
      'Verifying...';
  }

  window.verifyOtp(
    otp,

    data => {
      console.log(
        'OTP verified:',
        data
      );

      const accessToken =
        data?.['access-token'] ||
        data?.accessToken ||
        data?.token ||
        data?.data?.['access-token'] ||
        data?.data?.accessToken ||
        '';

      if (!accessToken) {
        console.error(
          'MSG91 response:',
          data
        );

        toast(
          'OTP verified, but no verification token was returned.'
        );

        if (button) {
          button.disabled =
            false;
          button.textContent =
            'Verify OTP';
        }

        return;
      }

      state.otp.verified =
        true;

      state.otp.accessToken =
        accessToken;

      const status =
        $('#otpStatus');

      if (status) {
        status.textContent =
          '✓ Mobile number verified successfully.';
      }

      if (otpInput) {
        otpInput.disabled =
          true;
      }

      if (button) {
        button.disabled =
          true;
        button.textContent =
          '✓ Verified';
      }

      const sendButton =
        $('#sendOtpButton');

      if (sendButton) {
        sendButton.disabled =
          true;
        sendButton.textContent =
          '✓ Mobile verified';
      }

      toast(
        'Mobile number verified.'
      );
    },

    error => {
      console.error(
        'OTP verification error:',
        error
      );

      toast(
        'Invalid or expired OTP.'
      );

      if (button) {
        button.disabled =
          false;
        button.textContent =
          'Verify OTP';
      }
    },
  );
}

/*
 * RESEND OTP
 */
async function resendSignupOTP() {
  if (
    !state.otp.requested ||
    !state.otp.mobile
  ) {
    toast(
      'Please send an OTP first.'
    );
    return;
  }

  const button =
    $('#resendOtpButton');

  if (button) {
    button.disabled = true;
    button.textContent =
      'Sending...';
  }

  try {
    await initializeMSG91();

    window.retryOtp(
      '11',

      data => {
        const newReqId =
          data?.reqId ||
          data?.reqID ||
          data?.requestId ||
          data?.data?.reqId ||
          data?.data?.reqID ||
          data?.data?.requestId ||
          '';

        if (newReqId) {
          state.otp.reqId = newReqId;
        }

        toast(
          'A new OTP has been sent.'
        );
      },

      error => {
        console.error(
          'OTP resend error:',
          error
        );

        toast(
          'Unable to resend OTP.'
        );
      },
    );

  } catch (error) {
    toast(
      error.message
    );
  } finally {
    setTimeout(() => {
      if (button) {
        button.disabled =
          false;
        button.textContent =
          'Resend OTP';
      }
    }, 30000);
  }
}

/*
 * SIGNUP SUBMIT
 */
async function submitSignup(event) {
  event.preventDefault();

  const form =
    event.target;

  if (!state.otp.verified) {
    toast(
      'Please verify your mobile number first.'
    );
    return;
  }

  if (!state.otp.accessToken) {
    toast(
      'Mobile verification is incomplete.'
    );
    return;
  }

  const button =
    $('#signupButton');

  if (button) {
    button.disabled =
      true;

    button.textContent =
      'Creating account...';
  }

  try {
    const data = {
      name:
        form.elements.name.value.trim(),

      email:
        form.elements.email.value.trim(),

      mobile:
        form.elements.mobile.value.trim(),

      password:
        form.elements.password.value,

      confirmPassword:
        form.elements.confirmPassword.value,

      otpAccessToken:
        state.otp.accessToken
    };

    const response =
      await api(
        '/api/auth/signup',
        {
          method: 'POST',
          body:
            JSON.stringify(data)
        }
      );

    state.token =
      response.token;

    state.user =
      response.user;

    localStorage.token =
      response.token;

    localStorage.user =
      JSON.stringify(
        response.user
      );

    resetOTPState();

    authModal.close();

updateAccount();
load();

toast(
  `Welcome, ${
    response.user.name
      .split(' ')[0]
  }!`
);
  } catch (error) {
    toast(
      error.message
    );
  } finally {
    if (button) {
      button.disabled =
        false;

      button.textContent =
        'Create account →';
    }
  }
}

/*
 * NORMAL LOGIN
 */
async function submitAuth(
  event,
  mode
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

    state.token =
      response.token;

    state.user =
      response.user;

    localStorage.token =
      response.token;

    localStorage.user =
      JSON.stringify(
        response.user
      );

    authModal.close();

    if (mode === 'login' && response.user.role === 'admin') {
      window.location.href = 'index.html';
      return;
    }

    updateAccount();

    load();

    toast(
      `Welcome, ${
        response.user.name
          .split(' ')[0]
      }!`
    );
  } catch (error) {
    toast(
      error.message
    );
  }
}

/*
 * LOGOUT
 */
function logout() {
  localStorage.clear();

  state.token = '';
  state.user = null;

  updateAccount();

  load();

  toast(
    'You are logged out.'
  );
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

        data.isBreaking =
          !!form.isBreaking
            .checked;

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

        $('#postModalTitle')
          .textContent =
          'Publish a story';

        $('#postSubmitLabel')
          .textContent =
          'Publish story →';

        load();

        toast(
          editing
            ? 'Story updated.'
            : 'Story published to the feed.'
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
updateAccount();

load();

loadMembers();

setInterval(
  load,
  30000
);
