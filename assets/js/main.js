/* PDFEdits landing page — interaction layer.
   No dependencies. Every effect is progressive enhancement. */

(() => {
  "use strict";

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  root.classList.add("js");

  /* ---------------- Theme ---------------- */
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeToggle = document.querySelector("[data-theme-toggle]");

  function applyTheme(theme, persist) {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem("pdfedits-theme", theme); } catch (e) {}
    }
    if (themeToggle) {
      const dark = theme === "dark";
      themeToggle.setAttribute("aria-pressed", String(dark));
      themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    }
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#0B1220" : "#F8FAFC");
  }

  if (themeToggle) {
    applyTheme(root.dataset.theme === "dark" ? "dark" : "light", false);
    themeToggle.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
    });
  }

  /* ---------------- Header + scroll progress ---------------- */
  const header = document.querySelector("[data-header]");
  const progress = document.querySelector("[data-progress]");
  let scrollQueued = false;

  function onScroll() {
    const y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 8);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
    }
    scrollQueued = false;
  }

  function requestScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(onScroll);
  }

  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll, { passive: true });
  onScroll();

  /* ---------------- Mobile menu ---------------- */
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const menu = document.querySelector("[data-menu]");

  function setMenu(open) {
    if (!menuToggle || !menu) return;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.hidden = !open;
    if (open) {
      const first = menu.querySelector("a");
      if (first) first.focus();
    }
  }

  if (menuToggle && menu) {
    menuToggle.addEventListener("click", () => {
      setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) setMenu(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        menuToggle.focus();
      }
    });

    document.addEventListener("click", (event) => {
      if (menuToggle.getAttribute("aria-expanded") !== "true") return;
      if (event.target.closest("[data-menu]") || event.target.closest("[data-menu-toggle]")) return;
      setMenu(false);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth >= 900) setMenu(false);
    }, { passive: true });
  }

  /* ---------------- Reveal on scroll ---------------- */
  const revealables = Array.from(document.querySelectorAll("[data-reveal]"));

  if (!("IntersectionObserver" in window) || reducedMotion.matches) {
    revealables.forEach((el) => el.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    revealables.forEach((el) => observer.observe(el));
  }

  /* ---------------- Counters ---------------- */
  const counters = Array.from(document.querySelectorAll("[data-count]"));

  function runCounter(el) {
    const target = Number(el.dataset.count) || 0;
    if (reducedMotion.matches || target === 0) {
      el.textContent = String(target);
      return;
    }
    const duration = 1100;
    const start = performance.now();

    function frame(now) {
      const t = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  if (counters.length) {
    // The markup ships the final values so the page reads correctly without JS;
    // zero them only when we are about to animate them.
    if (!reducedMotion.matches) {
      counters.forEach((el) => { el.textContent = "0"; });
    }

    if (!("IntersectionObserver" in window)) {
      counters.forEach(runCounter);
    } else {
      const counterObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          runCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      }, { threshold: 0.6 });

      counters.forEach((el) => counterObserver.observe(el));
    }
  }

  /* ---------------- Tool filter ---------------- */
  const tabs = Array.from(document.querySelectorAll("[data-filter]"));
  const tools = Array.from(document.querySelectorAll("[data-tool-grid] .tool"));
  const status = document.querySelector("[data-filter-status]");
  const labels = {
    all: "all",
    organize: "organising",
    edit: "editing",
    convert: "conversion",
    secure: "security",
    optimize: "optimisation",
  };

  function filterTools(value) {
    let shown = 0;

    tools.forEach((tool) => {
      const match = value === "all" || tool.dataset.cat === value;
      if (match) {
        shown += 1;
        tool.hidden = false;
        tool.style.setProperty("--k", String(shown));
        tool.classList.remove("is-entering");
        // restart the entrance animation
        void tool.offsetWidth;
        tool.classList.add("is-entering");
      } else {
        tool.hidden = true;
        tool.classList.remove("is-entering");
      }
    });

    if (status) {
      status.textContent =
        value === "all"
          ? `Showing all ${shown} tools`
          : `Showing ${shown} ${labels[value] || ""} ${shown === 1 ? "tool" : "tools"}`;
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-pressed", String(active));
      });
      filterTools(tab.dataset.filter);
    });

    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
    });
  });

  /* ---------------- Hero page reorder (FLIP) ---------------- */
  const thumbList = document.querySelector("[data-thumbs]");

  if (thumbList) {
    const thumbs = Array.from(thumbList.querySelectorAll("[data-thumb]"));
    let interval = null;
    let visible = true;

    function rotateThumbs() {
      if (document.hidden || !visible || reducedMotion.matches || thumbs.length < 2) return;

      const rects = new Map(thumbs.map((t) => [t, t.getBoundingClientRect()]));
      thumbList.appendChild(thumbs[0]);

      thumbs.forEach((thumb) => {
        const before = rects.get(thumb);
        const after = thumb.getBoundingClientRect();
        const dy = before.top - after.top;
        if (!dy) return;
        thumb.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
          { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      });

      thumbs.forEach((t) => t.classList.remove("is-active"));
      const moved = thumbs[0];
      moved.classList.add("is-active");
      window.setTimeout(() => moved.classList.remove("is-active"), 1200);
    }

    function startRotation() {
      if (interval !== null) return;
      interval = window.setInterval(rotateThumbs, 3600);
    }

    function stopRotation() {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    }

    if (reducedMotion.matches) {
      thumbs[0].classList.add("is-active");
    } else {
      startRotation();

      if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
          visible = entries[0].isIntersecting;
          if (visible) startRotation();
          else stopRotation();
        }, { threshold: 0.2 }).observe(thumbList);
      }

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stopRotation();
        else startRotation();
      });
    }
  }

  /* ---------------- Pointer parallax on the hero mock ---------------- */
  const parallaxArea = document.querySelector("[data-parallax]");
  const tiltTarget = document.querySelector("[data-tilt]");

  if (parallaxArea && tiltTarget && finePointer.matches && !reducedMotion.matches) {
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let raf = null;

    function loop() {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      tiltTarget.style.transform =
        `perspective(1200px) rotateX(${(-currentY * 4).toFixed(2)}deg) rotateY(${(currentX * 5).toFixed(2)}deg) translate3d(${(currentX * 6).toFixed(2)}px, ${(currentY * 5).toFixed(2)}px, 0)`;

      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = null;
      }
    }

    function queue() {
      if (raf === null) raf = requestAnimationFrame(loop);
    }

    parallaxArea.addEventListener("pointermove", (event) => {
      const rect = parallaxArea.getBoundingClientRect();
      targetX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
      targetY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
      queue();
    }, { passive: true });

    parallaxArea.addEventListener("pointerleave", () => {
      targetX = 0;
      targetY = 0;
      queue();
    });
  }

  /* ---------------- FAQ: one answer at a time ---------------- */
  const faqItems = Array.from(document.querySelectorAll(".faq-item"));

  faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---------------- Footer year ---------------- */
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------------- Reduced motion changes ---------------- */
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotionChange = () => {
    if (!motionQuery.matches) return;
    revealables.forEach((el) => el.classList.add("is-visible"));
    counters.forEach((el) => {
      el.textContent = el.dataset.count || "0";
    });
  };

  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(onMotionChange);
  }
})();
