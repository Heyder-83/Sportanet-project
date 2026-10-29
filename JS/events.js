// JS/events.js
// Página de eventos: lista los eventos publicados desde la API pública (GET /api/events), con buscador por nombre,
// pestañas Próximos / Pasados, "Ver más" y una ventana de detalle (GET /api/events/:id).
// Todo el texto que viene de la API se inserta con textContent (nunca como HTML).
(function () {
    'use strict';

    // Debe coincidir con APP_STATE.API_URL de JS/header.js.
    const API_URL = 'http://localhost:5000';
    const PAGE_SIZE = 12;
    const SEARCH_DELAY_MS = 350;
    const MAX_QUERY = 100;
    // Mismos valores que acepta la API (utils/eventsQuery.js). Vacío = orden predeterminado según la pestaña.
    const SORTS = ['name_asc', 'name_desc', 'newest', 'oldest'];

    const grid = document.getElementById('eventos-grid');
    const form = document.getElementById('buscador');
    const input = document.getElementById('buscador-input');
    const clearBtn = document.getElementById('buscador-limpiar');
    const summary = document.getElementById('eventos-resumen');
    const moreWrap = document.getElementById('eventos-mas');
    const moreBtn = document.getElementById('btn-mas');
    const tabs = Array.from(document.querySelectorAll('.eventos-tab'));
    const sortSelect = document.getElementById('orden');
    const dialog = document.getElementById('evento-dialog');
    const dialogBody = document.getElementById('evento-dialog-body');
    const dialogClose = document.getElementById('evento-dialog-cerrar');
    const toast = document.getElementById('eventos-aviso');

    const state = { q: '', sort: '', when: 'upcoming', page: 1, totalPages: 0, total: 0, requestId: 0, controller: null };

    // ---------- utilidades ----------
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    // 'YYYY-MM-DDTHH:MM:SS' (hora local del evento) -> fecha legible SIN convertir de zona horaria.
    function parseLocal(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
        return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
    }
    const dateFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
    const timeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
    const longFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    function formatDate(iso) {
        const d = parseLocal(iso);
        return d ? dateFmt.format(d) : '';
    }
    function formatWhen(startIso, endIso) {
        const s = parseLocal(startIso);
        const e = parseLocal(endIso);
        if (!s) return '';
        const sameDay = e && s.toISOString().slice(0, 10) === e.toISOString().slice(0, 10);
        if (!e) return `${longFmt.format(s)}, ${timeFmt.format(s)}`;
        return sameDay
            ? `${longFmt.format(s)}, ${timeFmt.format(s)} a ${timeFmt.format(e)}`
            : `${longFmt.format(s)}, ${timeFmt.format(s)} — ${longFmt.format(e)}, ${timeFmt.format(e)}`;
    }
    function formatPrice(price, currency) {
        if (!price) return 'Gratis';
        try {
            return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
        } catch (_) {
            return `${price} ${currency}`;
        }
    }
    const MODALITY = { InPerson: 'Presencial', Virtual: 'Virtual', Hybrid: 'Híbrido' };

    // Solo rutas del sitio (img/foto.jpg) o https. Cualquier otra cosa se descarta y se muestra el marcador de posición.
    function safeImage(url) {
        if (typeof url !== 'string' || !url || url.length > 500 || /(^|\/)\.\.(\/|$)/.test(url)) return null;
        if (/^https:\/\/[^\s<>"'`\\]+$/i.test(url)) return url;
        return /^\/?[A-Za-z0-9_-][A-Za-z0-9_\-./ ()]*$/.test(url) ? url : null;
    }

    function showToast(message) {
        toast.textContent = message;
        toast.hidden = false;
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
    }

    // ---------- tarjetas ----------
    function statusLabel(ev) {
        if (ev.status === 'Canceled') return 'Cancelado';
        if (ev.is_past) return 'Finalizado';
        if (ev.spots_left === 0) return 'Cupo completo';
        return null;
    }

    function imageBlock(ev) {
        const box = el('div', 'evento-imagen');
        const src = safeImage(ev.cover_image);
        if (src) {
            const img = el('img');
            img.src = src;
            img.alt = `Imagen de ${ev.title}`;
            img.loading = 'lazy';
            img.addEventListener('error', () => img.remove());
            box.appendChild(img);
        } else {
            box.appendChild(el('span', 'evento-sin-imagen', (ev.sport || '?').charAt(0).toUpperCase()));
        }
        box.appendChild(el('span', 'evento-etiqueta', ev.sport));
        const label = statusLabel(ev);
        if (label) box.appendChild(el('span', 'evento-estado', label));
        return box;
    }

    function buildCard(ev) {
        const card = el('article', 'evento-card');
        card.appendChild(imageBlock(ev));

        const body = el('div', 'evento-contenido');
        body.appendChild(el('h3', 'evento-titulo', ev.title));

        const info = el('div', 'evento-info');
        const place = ev.venue ? [ev.venue.name, ev.venue.city].filter(Boolean).join(', ') : (ev.modality === 'Virtual' ? 'Evento virtual' : 'Lugar por confirmar');
        info.appendChild(infoItem(place));
        if (ev.club) info.appendChild(infoItem(ev.club.name));
        body.appendChild(info);

        if (ev.excerpt) body.appendChild(el('p', 'evento-descripcion-card', ev.excerpt));

        const details = el('div', 'evento-detalles');
        details.appendChild(el('span', 'evento-participantes', `${ev.confirmed_count} de ${ev.capacity} inscritos`));
        details.appendChild(el('span', 'evento-fecha', formatDate(ev.start_at)));
        details.appendChild(el('span', 'evento-precio', formatPrice(ev.price, ev.currency)));
        body.appendChild(details);

        const buttons = el('div', 'evento-botones');
        const detailBtn = el('button', 'btn-detalles', 'Ver detalles');
        detailBtn.type = 'button';
        detailBtn.addEventListener('click', () => openDetail(ev.id, detailBtn));
        const joinBtn = el('button', 'btn-inscribir', 'Inscribirse');
        joinBtn.type = 'button';
        const closed = ev.is_past || ev.status === 'Canceled' || ev.spots_left === 0;
        if (closed) {
            joinBtn.disabled = true;
            joinBtn.title = statusLabel(ev) || '';
        } else {
            joinBtn.addEventListener('click', () => join(ev));
        }
        buttons.append(detailBtn, joinBtn);
        body.appendChild(buttons);

        card.appendChild(body);
        return card;
    }
    function infoItem(text) {
        const item = el('div', 'info-item');
        item.appendChild(el('span', 'info-texto', text));
        return item;
    }

    // La inscripción en línea aún no existe en el backend: no se simula ningún resultado.
    function join(ev) {
        if (!localStorage.getItem('user')) {
            showToast('Para inscribirte, primero inicia sesión.');
            const modal = document.getElementById('modal-auth');
            if (modal) {
                modal.classList.add('show');
                modal.setAttribute('aria-hidden', 'false');
            }
            return;
        }
        showToast(`La inscripción en línea a «${ev.title}» todavía no está disponible. Muy pronto podrás hacerlo desde aquí.`);
    }

    // ---------- listado ----------
    function renderState(kind, message, retry) {
        grid.replaceChildren();
        const box = el('div', `evento-placeholder evento-placeholder-${kind}`);
        box.appendChild(el('p', null, message));
        if (retry) {
            const btn = el('button', 'btn-reintentar', 'Reintentar');
            btn.type = 'button';
            btn.addEventListener('click', retry);
            box.appendChild(btn);
        }
        grid.appendChild(box);
        moreWrap.hidden = true;
    }

    function updateSummary() {
        if (!state.total) { summary.textContent = ''; return; }
        const noun = state.total === 1 ? 'evento' : 'eventos';
        summary.textContent = state.q ? `${state.total} ${noun} para «${state.q}»` : `${state.total} ${noun}`;
    }

    async function load({ append }) {
        if (state.controller) state.controller.abort(); // una búsqueda nueva cancela la anterior
        state.controller = new AbortController();
        const myId = ++state.requestId;
        const page = append ? state.page + 1 : 1;

        grid.setAttribute('aria-busy', 'true');
        if (!append) {
            summary.textContent = '';
            renderState('cargando', 'Cargando eventos…');
        } else {
            moreBtn.disabled = true;
        }

        const params = new URLSearchParams({ when: state.when, page: String(page), limit: String(PAGE_SIZE) });
        if (state.q) params.set('q', state.q);
        if (state.sort) params.set('sort', state.sort);

        try {
            const res = await fetch(`${API_URL}/api/events?${params}`, { signal: state.controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            if (myId !== state.requestId) return; // llegó una respuesta vieja

            if (!append) grid.replaceChildren();
            state.page = body.page;
            state.total = body.total;
            state.totalPages = body.total_pages;

            if (!body.data.length && !append) {
                const label = state.when === 'past' ? 'pasados' : 'próximos';
                renderState('vacio', state.q
                    ? `No encontramos eventos ${label} con «${state.q}». Prueba con otro nombre.`
                    : `Todavía no hay eventos ${label}.`);
            } else {
                body.data.forEach((ev) => grid.appendChild(buildCard(ev)));
            }
            updateSummary();
            moreWrap.hidden = state.page >= state.totalPages;
        } catch (err) {
            if (err.name === 'AbortError' || myId !== state.requestId) return;
            if (append) showToast('No se pudieron cargar más eventos. Inténtalo de nuevo.');
            else renderState('error', 'No pudimos cargar los eventos. Revisa tu conexión e inténtalo de nuevo.', () => load({ append: false }));
        } finally {
            if (myId === state.requestId) {
                grid.setAttribute('aria-busy', 'false');
                moreBtn.disabled = false;
            }
        }
    }

    // ---------- búsqueda y pestañas ----------
    function syncUrl() {
        const p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.when !== 'upcoming') p.set('when', state.when);
        if (state.sort) p.set('sort', state.sort);
        const qs = p.toString();
        history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    }

    function applySearch(raw) {
        const q = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
        clearBtn.hidden = !raw.length;
        if (q === state.q) return;
        state.q = q;
        syncUrl();
        load({ append: false });
    }

    let searchTimer;
    input.addEventListener('input', () => {
        clearBtn.hidden = !input.value.length;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applySearch(input.value), SEARCH_DELAY_MS);
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearTimeout(searchTimer);
        applySearch(input.value);
    });
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearTimeout(searchTimer);
        applySearch('');
        input.focus();
    });

    function selectTab(when, { focus } = {}) {
        tabs.forEach((t) => {
            const on = t.dataset.when === when;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            if (on && focus) t.focus();
        });
        if (when === state.when) return;
        state.when = when;
        syncUrl();
        load({ append: false });
    }
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab.dataset.when));
        tab.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            selectTab(next.dataset.when, { focus: true });
        });
    });
    moreBtn.addEventListener('click', () => load({ append: true }));

    // El orden se mantiene al cambiar de pestaña o de búsqueda.
    sortSelect.addEventListener('change', () => {
        state.sort = SORTS.includes(sortSelect.value) ? sortSelect.value : '';
        syncUrl();
        load({ append: false });
    });

    // ---------- detalle ----------
    function row(label, value) {
        const wrap = el('div', 'detalle-fila');
        wrap.appendChild(el('dt', null, label));
        wrap.appendChild(el('dd', null, value));
        return wrap;
    }

    function renderDetail(ev) {
        dialogBody.replaceChildren();
        const src = safeImage(ev.cover_image);
        if (src) {
            const img = el('img', 'detalle-portada');
            img.src = src;
            img.alt = `Imagen de ${ev.title}`;
            img.addEventListener('error', () => img.remove());
            dialogBody.appendChild(img);
        }
        const head = el('div', 'detalle-cabecera');
        head.appendChild(el('span', 'evento-etiqueta evento-etiqueta-inline', ev.sport));
        const label = statusLabel(ev);
        if (label) head.appendChild(el('span', 'evento-estado evento-estado-inline', label));
        dialogBody.appendChild(head);
        const title = el('h2', 'detalle-titulo', ev.title);
        title.id = 'evento-dialog-titulo';
        dialogBody.appendChild(title);

        if (ev.status === 'Canceled') {
            dialogBody.appendChild(el('p', 'detalle-cancelado', ev.cancel_reason ? `Evento cancelado: ${ev.cancel_reason}` : 'Este evento fue cancelado.'));
        }

        const list = el('dl', 'detalle-datos');
        list.appendChild(row('Cuándo', formatWhen(ev.start_at, ev.end_at)));
        if (ev.venue) {
            list.appendChild(row('Dónde', [ev.venue.name, ev.venue.address, ev.venue.city, ev.venue.region].filter(Boolean).join(', ')));
        } else if (ev.modality === 'Virtual') {
            list.appendChild(row('Dónde', 'Evento virtual'));
        }
        list.appendChild(row('Modalidad', MODALITY[ev.modality] || ev.modality));
        list.appendChild(row('Precio', formatPrice(ev.price, ev.currency)));
        list.appendChild(row('Inscritos', `${ev.confirmed_count} de ${ev.capacity} (${ev.spots_left} ${ev.spots_left === 1 ? 'cupo disponible' : 'cupos disponibles'})`));
        if (ev.registration_deadline) list.appendChild(row('Inscripción hasta', `${formatDate(ev.registration_deadline)}, ${timeFmt.format(parseLocal(ev.registration_deadline))}`));
        if (ev.club) list.appendChild(row('Club', ev.club.address ? `${ev.club.name} · ${ev.club.address}` : ev.club.name));
        dialogBody.appendChild(list);

        if (ev.description) dialogBody.appendChild(el('p', 'detalle-descripcion', ev.description));

        // Organización: 'Club' = el club en general (sin delegados); 'Specific' = personas concretas.
        const orgBox = el('section', 'detalle-organizacion');
        orgBox.appendChild(el('h3', null, 'Organización'));
        if (ev.staff_mode === 'Specific' && ev.staff.length) {
            const ul = el('ul', 'detalle-personal');
            ev.staff.forEach((s) => ul.appendChild(el('li', null, `${s.name} — ${s.role}`)));
            orgBox.appendChild(ul);
        } else {
            orgBox.appendChild(el('p', null, ev.club ? `Organizado por ${ev.club.name}.` : `Organizado por ${ev.organizer.name}.`));
        }
        dialogBody.appendChild(orgBox);

        const gallery = ev.images.map((i) => ({ src: safeImage(i.url), alt: i.alt })).filter((i) => i.src);
        if (gallery.length) {
            const box = el('div', 'detalle-galeria');
            gallery.forEach((g) => {
                const img = el('img');
                img.src = g.src;
                img.alt = g.alt || `Imagen de ${ev.title}`;
                img.loading = 'lazy';
                img.addEventListener('error', () => img.remove());
                box.appendChild(img);
            });
            dialogBody.appendChild(box);
        }
        dialog.setAttribute('aria-labelledby', 'evento-dialog-titulo');
    }

    let lastTrigger = null;
    async function openDetail(id, trigger) {
        lastTrigger = trigger || null;
        dialogBody.replaceChildren(el('p', 'detalle-estado', 'Cargando…'));
        if (!dialog.open) dialog.showModal();
        try {
            const res = await fetch(`${API_URL}/api/events/${encodeURIComponent(id)}`);
            if (res.status === 404) throw new Error('not-found');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            renderDetail(await res.json());
        } catch (err) {
            dialogBody.replaceChildren(el('p', 'detalle-estado', err.message === 'not-found'
                ? 'Este evento ya no está disponible.'
                : 'No pudimos cargar el detalle del evento. Inténtalo de nuevo.'));
        }
    }
    dialogClose.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // clic en el fondo
    dialog.addEventListener('close', () => { if (lastTrigger) lastTrigger.focus(); });

    // ---------- inicio ----------
    const params = new URLSearchParams(location.search);
    const initialQ = (params.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
    if (params.get('when') === 'past') state.when = 'past';
    if (SORTS.includes(params.get('sort'))) state.sort = params.get('sort');
    sortSelect.value = state.sort;
    state.q = initialQ;
    input.value = initialQ;
    clearBtn.hidden = !initialQ;
    tabs.forEach((t) => {
        const on = t.dataset.when === state.when;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
    });
    load({ append: false });
})();
