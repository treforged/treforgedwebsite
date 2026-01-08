// Robust hamburger + persistent dark mode + reveal on scroll
(function(){
  // Helper: apply theme from stored preference or system
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    // --- Theme persistence ---
    const stored = localStorage.getItem('tf-theme'); // 'dark' | 'light' | null
    if (stored) {
      applyTheme(stored);
    } else {
      // Optional: use prefers-color-scheme default if no stored preference
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }

    // Create theme toggle (if not already present)
    if (!document.getElementById('tf-theme-toggle')) {
      const toggle = document.createElement("div");
      toggle.id = 'tf-theme-toggle';
      toggle.textContent = document.body.classList.contains('dark') ? "☀️" : "🌓";
      toggle.style.position = "fixed";
      toggle.style.bottom = "20px";
      toggle.style.right = "20px";
      toggle.style.fontSize = "26px";
      toggle.style.cursor = "pointer";
      toggle.style.zIndex = "9999";
      toggle.setAttribute('role','button');
      toggle.setAttribute('tabindex','0');
      toggle.setAttribute('aria-pressed', String(document.body.classList.contains('dark')));
      document.body.appendChild(toggle);

      function setToggleState(isDark) {
        toggle.textContent = isDark ? "☀️" : "🌓";
        toggle.setAttribute('aria-pressed', String(isDark));
      }

      toggle.addEventListener('click', function(){
        const isDark = document.body.classList.toggle('dark');
        localStorage.setItem('tf-theme', isDark ? 'dark' : 'light');
        setToggleState(isDark);
      });
      toggle.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    // --- Mobile hamburger behavior ---
    const burger = document.getElementById('burger');
    const mobileNav = document.getElementById('mobileNav');

    if (burger && mobileNav) {
      // Ensure accessibility attributes
      burger.setAttribute('role', burger.getAttribute('role') || 'button');
      if (!burger.hasAttribute('tabindex')) burger.setAttribute('tabindex','0');
      if (!burger.hasAttribute('aria-controls')) burger.setAttribute('aria-controls', 'mobileNav');
      if (!burger.hasAttribute('aria-expanded')) burger.setAttribute('aria-expanded','false');

      const openClass = 'open';
      const toggleNav = (evt) => {
        if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
        const isOpen = mobileNav.classList.contains(openClass);
        if (!isOpen) {
          // Open
          mobileNav.classList.add(openClass);
          // override inline/display to ensure visibility on iOS where inline style may have been display:none
          mobileNav.style.display = 'block';
          burger.setAttribute('aria-expanded','true');
        } else {
          // Close
          mobileNav.classList.remove(openClass);
          mobileNav.style.display = 'none';
          burger.setAttribute('aria-expanded','false');
        }
      };

      // Click handler
      burger.addEventListener('click', toggleNav);

      // Touch handler (iOS) — prevent double events in some browsers
      burger.addEventListener('touchstart', function(e){
        // prevent default so some browsers don't delay/convert into a click later
        e.preventDefault();
        toggleNav(e);
      }, { passive: false });

      // Keyboard support
      burger.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          toggleNav(e);
        }
      });

      // Close when clicking links
      mobileNav.querySelectorAll('a').forEach(a=>{
        a.addEventListener('click', ()=> {
          mobileNav.classList.remove(openClass);
          mobileNav.style.display = 'none';
          burger.setAttribute('aria-expanded','false');
        });
      });

      // Close when clicking/tapping outside
      document.addEventListener('touchstart', function(e){
        if (!mobileNav.classList.contains(openClass)) return;
        if (!mobileNav.contains(e.target) && !burger.contains(e.target)) {
          mobileNav.classList.remove(openClass);
          mobileNav.style.display = 'none';
          burger.setAttribute('aria-expanded','false');
        }
      }, { passive: true });
      document.addEventListener('click', function(e){
        if (!mobileNav.classList.contains(openClass)) return;
        if (!mobileNav.contains(e.target) && !burger.contains(e.target)) {
          mobileNav.classList.remove(openClass);
          mobileNav.style.display = 'none';
          burger.setAttribute('aria-expanded','false');
        }
      });

      // Close when resizing to desktop widths
      window.addEventListener('resize', () => {
        if (window.innerWidth > 900 && mobileNav.classList.contains(openClass)) {
          mobileNav.classList.remove(openClass);
          mobileNav.style.display = 'none';
          burger.setAttribute('aria-expanded','false');
        }
      });
    }

    // --- Reveal on scroll ---
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, {threshold: 0.12});
    document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
  });
})();
// --- Smooth image loading (fade in) ---
(function(){
  function markLoaded(img){
    img.classList.add('is-loaded');
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('img.smooth-img').forEach(img=>{
      if (img.complete) {
        markLoaded(img);
      } else {
        img.addEventListener('load', ()=>markLoaded(img), { once: true });
        img.addEventListener('error', ()=>markLoaded(img), { once: true }); // avoid invisible broken images
      }
    });
  });
})();
// --- Image popup (lightbox) with keyboard + swipe (only if modal exists) ---
(function(){
  const modal = document.getElementById("imgModal");
  const modalImg = document.getElementById("modalImage");
  const captionText = document.getElementById("caption");
  const closeBtn = document.querySelector(".close");
  const images = Array.from(document.querySelectorAll(".popup-img"));

  if (!modal || !modalImg || images.length === 0) return;

  let currentIndex = -1;

  function openModal(index){
    currentIndex = index;
    modal.style.display = "block";
    modalImg.src = images[index].src;
    if (captionText) captionText.textContent = images[index].alt || "";
  }

  function closeModal(){
    modal.style.display = "none";
  }

  images.forEach((img, i) => {
    img.addEventListener("click", () => openModal(i));
  });

  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", function(e){
    if (e.target === modal) closeModal();
  });

  // Keyboard navigation
  document.addEventListener("keydown", function(e){
    if (modal.style.display !== "block") return;
    if (e.key === "Escape") return closeModal();
    if (e.key === "ArrowRight") openModal((currentIndex + 1) % images.length);
    if (e.key === "ArrowLeft") openModal((currentIndex - 1 + images.length) % images.length);
  });

  // Touch swipe navigation
  let startX = 0;
  modal.addEventListener("touchstart", (e)=>{ startX = e.touches[0].clientX; }, {passive:true});
  modal.addEventListener("touchend", (e)=>{
    if (modal.style.display !== "block") return;
    const endX = e.changedTouches[0].clientX;
    const delta = startX - endX;
    if (delta > 50) openModal((currentIndex + 1) % images.length);      // swipe left
    if (delta < -50) openModal((currentIndex - 1 + images.length) % images.length); // swipe right
  }, {passive:true});
})();
