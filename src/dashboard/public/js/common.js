const nativeFetch = window.fetch.bind(window);
let csrfTokenPromise;

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = nativeFetch('/auth/csrf', {
      credentials: 'same-origin',
    })
      .then(response => {
        if (!response.ok) throw new Error('CSRF 토큰을 가져오지 못했습니다.');
        return response.json();
      })
      .then(data => data.csrfToken)
      .catch(error => {
        csrfTokenPromise = null;
        throw error;
      });
  }
  return csrfTokenPromise;
}

window.fetch = async function csrfAwareFetch(input, init = {}) {
  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  const requestUrl = new URL(request.url, window.location.href);
  const isSameOrigin = requestUrl.origin === window.location.origin;
  const isUnsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (!isSameOrigin || !isUnsafeMethod) {
    return nativeFetch(input, init);
  }

  const token = await getCsrfToken();
  const headers = new Headers(request.headers);
  headers.set('X-CSRF-Token', token);

  return nativeFetch(input, {
    ...init,
    headers,
    credentials: init.credentials || 'same-origin',
  });
};

async function api(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...opts.headers } });
    const contentType = r.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await r.json()
      : null;

    if (r.status === 401 && body?.redirect) {
      window.location.assign(body.redirect);
      throw new Error(body.error || '로그인이 필요합니다.');
    }

    if (!r.ok) {
      throw new Error(body?.error || `요청에 실패했습니다. (${r.status})`);
    }

    if (body === null) {
      throw new Error('서버가 JSON 응답을 반환하지 않았습니다.');
    }

    return body;
  } catch (err) { showToast(err.message, "error"); throw err; }
}
function formatMoney(n) { return n.toLocaleString() + "원"; }

/* ================================
   공용 모달 유틸리티 (22번 작업)
   ================================ */

// 토스트 알림 (기존 alert 대체)
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container") || createToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icons = { success: "✓", error: "✕", warning: "!", info: "i" };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-message">${message}</span>`;
  
  container.appendChild(toast);
  
  // 애니메이션 후 제거
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });
  
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createToastContainer() {
  const container = document.createElement("div");
  container.id = "toast-container";
  document.body.appendChild(container);
  return container;
}

// 확인/취소 모달 (기존 confirm 대체)
function showConfirm(message, onConfirm, onCancel) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay confirm-overlay active";
  
  overlay.innerHTML = `
    <div class="modal confirm-modal">
      <div class="modal-icon confirm-icon">?</div>
      <p class="confirm-message">${message}</p>
      <div class="confirm-buttons">
        <button class="btn btn-outline confirm-cancel">취소</button>
        <button class="btn btn-primary confirm-ok">확인</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // 닫기 함수
  const close = () => {
    overlay.classList.remove("active");
    setTimeout(() => overlay.remove(), 300);
  };
  
  // 버튼 이벤트
  overlay.querySelector(".confirm-cancel").addEventListener("click", () => {
    close();
    if (onCancel) onCancel();
  });
  
  overlay.querySelector(".confirm-ok").addEventListener("click", () => {
    close();
    if (onConfirm) onConfirm();
  });
  
  // 오버레이 클릭 시 닫기
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
      if (onCancel) onCancel();
    }
  });
  
  // ESC 키로 닫기
  const escHandler = (e) => {
    if (e.key === "Escape") {
      close();
      if (onCancel) onCancel();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

// 텍스트 입력 모달 (기존 prompt 대체)
function showPrompt(title, placeholder = "", defaultValue = "", onSubmit) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay prompt-overlay active";
  
  overlay.innerHTML = `
    <div class="modal prompt-modal">
      <div class="modal-header">
        <span>${title}</span>
        <button class="modal-close prompt-close">&times;</button>
      </div>
      <div class="input-group">
        <input type="text" class="input prompt-input" placeholder="${placeholder}" value="${defaultValue}" autofocus>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline prompt-cancel">취소</button>
        <button class="btn btn-primary prompt-submit">확인</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  const input = overlay.querySelector(".prompt-input");
  const close = () => {
    overlay.classList.remove("active");
    setTimeout(() => overlay.remove(), 300);
  };
  const submit = () => {
    const value = input.value;
    close();
    if (onSubmit) onSubmit(value);
  };
  
  // 이벤트 바인딩
  overlay.querySelector(".prompt-close").addEventListener("click", close);
  overlay.querySelector(".prompt-cancel").addEventListener("click", close);
  overlay.querySelector(".prompt-submit").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
  });
  
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// 공통 모달 열기/닫기 유틸
function openModal(modalId) {
  document.getElementById(modalId)?.classList.add("active");
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove("active");
}

// 레거시 함수 호환성
const toast = showToast;
