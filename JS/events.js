// JS/events.js
// Página de eventos: lista los eventos publicados desde la API pública (GET /api/events), con buscador por nombre,
// pestañas Próximos / Pasados, "Ver más" y una ventana de detalle (GET /api/events/:id).
// Todo el texto que viene de la API se inserta con textContent (nunca como HTML).
(function () {
    'use strict';

    // En Azure se usa el mismo origen mediante rutas relativas.
    // En desarrollo con Live Server se conserva el backend local del puerto 5000.
    // Puede definirse window.SPORTANET_API_URL antes de cargar este archivo para sobrescribirlo.
    const API_URL = (() => {
        const configuredUrl = window.SPORTANET_API_URL;
        if (typeof configuredUrl === 'string' && configuredUrl.trim()) {
            return configuredUrl.trim().replace(/\/+$/, '');
        }

        const localHosts = ['localhost', '127.0.0.1'];
        const isSeparateLocalFrontend = localHosts.includes(window.location.hostname)
            && window.location.port !== '5000';

        return isSeparateLocalFrontend ? 'http://localhost:5000' : '';
    })();
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
    const organizerPanel = document.getElementById('panel-organizador');
    const participantPanel = document.getElementById('panel-atleta');
    const eventForm = document.getElementById('form-evento');
    const eventFormTitle = document.getElementById('form-evento-titulo');
    const eventFormSubmit = document.getElementById('evento-guardar');
    const eventFormCancel = document.getElementById('evento-edicion-cancelar');
    const eventFormNotice = document.getElementById('evento-form-aviso');
    const organizerList = document.getElementById('eventos-organizador-lista');
    const registrationsPanel = document.getElementById('panel-inscritos');
    const registrationsList = document.getElementById('lista-inscritos');
    const myRegistrations = document.getElementById('mis-inscripciones');
    let editingEventId = null;

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

    function signedInUser() {
        try { return JSON.parse(localStorage.getItem('user') || 'null'); }
        catch (_) { return null; }
    }
    function hasSession() { return Boolean(localStorage.getItem('auth_token') && signedInUser()); }
    async function apiRequest(path, options = {}) {
        const headers = new Headers(options.headers || {});
        const token = localStorage.getItem('auth_token');
        if (token) headers.set('Authorization', `Bearer ${token}`);
        if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const response = await fetch(`${API_URL}${path}`, { ...options, headers });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.error || `HTTP ${response.status}`);
            error.code = body.code;
            error.status = response.status;
            throw error;
        }
        return body;
    }
    function statusText(status) {
        return ({ Draft: 'Borrador', Published: 'Publicado', Completed: 'Finalizado', Canceled: 'Cancelado',
            Pending: 'Pendiente', Confirmed: 'Confirmada', Waitlisted: 'En lista de espera' })[status] || status;
    }
    function showLogin() {
        const modal = document.getElementById('modal-auth');
        if (modal) { modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); }
        else showToast('Inicia sesión para continuar.');
    }
    function syncAccountPanels() {
        const user = signedInUser();
        organizerPanel.hidden = !(hasSession() && user?.role === 'Organizer');
        participantPanel.hidden = !(hasSession() && user?.role === 'Participant');
        if (!organizerPanel.hidden) loadOrganizerEvents();
        if (!participantPanel.hidden) loadMyRegistrations();
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
        const user = signedInUser();
        const joinBtn = el('button', 'btn-inscribir', user?.role === 'Organizer' ? 'Panel organizador' : ev.spots_left === 0 ? 'Lista de espera' : 'Inscribirse');
        joinBtn.type = 'button';
        const closed = ev.is_past || ev.status === 'Canceled';
        if (user?.role === 'Organizer') {
            joinBtn.addEventListener('click', () => organizerPanel.scrollIntoView({ behavior: 'smooth' }));
        } else if (user?.role === 'Admin') {
            joinBtn.disabled = true;
            joinBtn.title = 'Las cuentas de administración no participan en eventos.';
        } else if (closed) {
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

    async function join(ev) {
        if (!hasSession()) return showLogin();
        if (signedInUser()?.role !== 'Participant') return showToast('Solo las cuentas de atleta pueden inscribirse.');
        try {
            const result = await apiRequest(`/api/events/${encodeURIComponent(ev.id)}/registrations`, { method: 'POST', body: '{}' });
            const text = result.status === 'Confirmed' ? 'Inscripción confirmada.'
                : result.status === 'Waitlisted' ? 'El evento está lleno; quedaste en lista de espera.'
                    : result.payment_status === 'Pending' ? 'Inscripción pendiente de pago.'
                        : 'Inscripción enviada al organizador para aprobación.';
            showToast(text);
            await Promise.all([load({ append: false }), loadMyRegistrations()]);
        } catch (error) {
            const messages = {
                ALREADY_REGISTERED: 'Ya tienes una inscripción activa para este evento.',
                REGISTRATION_CLOSED: 'El plazo de inscripción ya terminó.',
                EVENT_NOT_FOUND: 'Este evento no admite inscripciones.'
            };
            showToast(messages[error.code] || 'No pudimos completar la inscripción.');
        }
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
        const user = signedInUser();
        if (ev.status === 'Published' && !ev.is_past && user?.role !== 'Organizer' && user?.role !== 'Admin') {
            const join = el('button', 'btn-inscribir', ev.spots_left === 0 ? 'Unirme a lista de espera' : 'Inscribirme');
            join.type = 'button';
            join.addEventListener('click', () => joinEventFromDetail(ev));
            dialogBody.appendChild(join);
        }
        dialog.setAttribute('aria-labelledby', 'evento-dialog-titulo');
    }

    function joinEventFromDetail(event) { return join(event); }

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

    // ---------- gestión de eventos para organizadores ----------
    const modalitySelect = eventForm.elements.modality;
    const venueFieldset = eventForm.querySelector('.evento-ubicacion');
    const onlineUrlField = eventForm.elements.online_url;
    function syncVenueFields() {
        const visible = modalitySelect.value !== 'Virtual';
        venueFieldset.hidden = !visible;
        for (const field of venueFieldset.querySelectorAll('input')) field.required = visible;
        onlineUrlField.required = modalitySelect.value === 'Virtual';
    }
    modalitySelect.addEventListener('change', syncVenueFields);
    syncVenueFields();

    function clearEventEditor() {
        editingEventId = null;
        eventForm.reset();
        eventForm.elements.max_capacity.value = '20';
        eventForm.elements.price.value = '0';
        eventForm.elements.event_status.value = 'Draft';
        eventFormTitle.textContent = 'Crear evento';
        eventFormSubmit.textContent = 'Crear evento';
        eventFormCancel.hidden = true;
        eventFormNotice.hidden = true;
        for (const field of [modalitySelect, ...venueFieldset.querySelectorAll('input')]) field.disabled = false;
        syncVenueFields();
    }
    function dateForInput(value) { return typeof value === 'string' ? value.slice(0, 16) : ''; }
    function editEvent(item) {
        editingEventId = item.id;
        eventForm.elements.title.value = item.title || '';
        eventForm.elements.sport.value = item.sport || '';
        eventForm.elements.event_description.value = item.event_description || '';
        eventForm.elements.start_at.value = dateForInput(item.start_at);
        eventForm.elements.end_at.value = dateForInput(item.end_at);
        eventForm.elements.max_capacity.value = String(item.capacity);
        eventForm.elements.price.value = String(item.price);
        eventForm.elements.registration_deadline.value = dateForInput(item.registration_deadline);
        eventForm.elements.event_status.value = item.status === 'Published' ? 'Published' : 'Draft';
        // El esquema mantiene los recintos como registros compartidos. La edición de un evento no cambia su sede.
        modalitySelect.value = item.modality;
        eventForm.elements.approval_mode.value = item.approval_mode;
        eventForm.elements.cover_image.value = item.cover_image || '';
        onlineUrlField.value = item.online_url || '';
        eventForm.elements.venue_name.value = item.venue_name || '';
        eventForm.elements.venue_address.value = item.venue_address || '';
        eventForm.elements.venue_city.value = item.venue_city || '';
        modalitySelect.disabled = true;
        for (const field of venueFieldset.querySelectorAll('input')) field.disabled = true;
        syncVenueFields();
        eventFormTitle.textContent = `Editar: ${item.title}`;
        eventFormSubmit.textContent = 'Guardar cambios';
        eventFormCancel.hidden = false;
        eventFormNotice.hidden = true;
        eventForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    eventFormCancel.addEventListener('click', clearEventEditor);
    eventForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        eventFormNotice.hidden = true;
        eventFormSubmit.disabled = true;
        const values = Object.fromEntries(new FormData(eventForm).entries());
        values.max_capacity = Number(values.max_capacity);
        values.price = Number(values.price);
        values.currency = 'COP';
        try {
            if (editingEventId) {
                const editable = Object.fromEntries(['title', 'sport', 'event_description', 'start_at', 'end_at', 'max_capacity', 'price', 'registration_deadline', 'event_status', 'approval_mode', 'cover_image', 'online_url'].map((key) => [key, values[key]]));
                await apiRequest(`/api/events/${editingEventId}`, { method: 'PUT', body: JSON.stringify(editable) });
                showToast('Cambios guardados.');
            } else {
                await apiRequest('/api/events', { method: 'POST', body: JSON.stringify(values) });
                showToast(values.event_status === 'Published' ? 'Evento publicado.' : 'Borrador guardado.');
            }
            clearEventEditor();
            await Promise.all([loadOrganizerEvents(), load({ append: false })]);
        } catch (error) {
            const messages = {
                VALIDATION_ERROR: 'Revisa los campos: título, fechas, cupos, precio y ubicación son obligatorios según la modalidad.',
                CAPACITY_CONFLICT: 'No puedes reducir el cupo por debajo del número de inscripciones confirmadas.',
                EVENT_CLOSED: 'Los eventos cancelados o finalizados ya no se pueden editar.'
            };
            eventFormNotice.textContent = messages[error.code] || 'No se pudo guardar el evento.';
            eventFormNotice.hidden = false;
        } finally { eventFormSubmit.disabled = false; }
    });

    async function loadOrganizerEvents() {
        organizerList.replaceChildren(el('p', 'evento-gestion-vacio', 'Cargando tus eventos…'));
        try {
            const items = await apiRequest('/api/events/mine');
            organizerList.replaceChildren();
            if (!items.length) organizerList.appendChild(el('p', 'evento-gestion-vacio', 'Todavía no has creado eventos.'));
            items.forEach((item) => {
                const card = el('article', 'evento-gestion-card');
                card.appendChild(el('h4', null, item.title));
                card.appendChild(el('p', null, `${statusText(item.status)} · ${formatWhen(item.start_at, item.end_at)}`));
                card.appendChild(el('p', null, `${item.confirmed_count} confirmados · ${item.pending_count} pendientes · ${item.capacity} cupos`));
                if (item.venue_name) card.appendChild(el('p', null, [item.venue_name, item.venue_city].filter(Boolean).join(', ')));
                const actions = el('div', 'evento-gestion-actions');
                if (['Draft', 'Published'].includes(item.status)) {
                    const edit = el('button', 'btn-detalles', 'Editar');
                    edit.type = 'button'; edit.addEventListener('click', () => editEvent(item)); actions.appendChild(edit);
                    const cancel = el('button', 'btn-peligro', 'Cancelar evento');
                    cancel.type = 'button'; cancel.addEventListener('click', async () => {
                        if (!window.confirm(`¿Cancelar «${item.title}»?`)) return;
                        const reason = window.prompt('Motivo de cancelación (opcional):') || '';
                        try {
                            await apiRequest(`/api/events/${item.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
                            showToast('Evento cancelado.');
                            await Promise.all([loadOrganizerEvents(), load({ append: false })]);
                        } catch (_) { showToast('No se pudo cancelar el evento.'); }
                    }); actions.appendChild(cancel);
                }
                if (item.status === 'Published') {
                    const complete = el('button', 'btn-detalles', 'Marcar finalizado');
                    complete.type = 'button'; complete.addEventListener('click', async () => {
                        try {
                            await apiRequest(`/api/events/${item.id}/complete`, { method: 'POST', body: '{}' });
                            showToast('Evento marcado como finalizado.');
                            await Promise.all([loadOrganizerEvents(), load({ append: false })]);
                        } catch (error) {
                            showToast(error.code === 'EVENT_NOT_ENDED' ? 'Solo puedes finalizarlo cuando termine.' : 'No se pudo finalizar el evento.');
                        }
                    }); actions.appendChild(complete);
                }
                const roster = el('button', 'btn-detalles', 'Ver inscripciones');
                roster.type = 'button'; roster.addEventListener('click', () => loadEventRegistrations(item.id, item.title)); actions.appendChild(roster);
                card.appendChild(actions);
                organizerList.appendChild(card);
            });
        } catch (_) { organizerList.replaceChildren(el('p', 'evento-gestion-vacio', 'No pudimos cargar tus eventos. Inicia sesión de nuevo e inténtalo.')); }
    }

    async function loadEventRegistrations(eventId, title) {
        registrationsPanel.hidden = false;
        document.getElementById('inscritos-titulo').textContent = `Inscripciones: ${title}`;
        registrationsList.replaceChildren(el('p', 'evento-gestion-vacio', 'Cargando…'));
        try {
            const items = await apiRequest(`/api/events/${eventId}/registrations`);
            registrationsList.replaceChildren();
            if (!items.length) registrationsList.appendChild(el('p', 'evento-gestion-vacio', 'Aún no hay inscripciones.'));
            items.forEach((item) => {
                const card = el('article', 'evento-inscrito-card');
                card.appendChild(el('strong', null, item.full_name));
                card.appendChild(el('p', null, item.email));
                card.appendChild(el('p', null, `${statusText(item.status)} · ${item.payment_status === 'Pending' ? 'Pago pendiente' : item.payment_status === 'NotRequired' ? 'Sin pago requerido' : item.payment_status}`));
                if (['Pending', 'Waitlisted'].includes(item.status)) {
                    const actions = el('div', 'evento-inscrito-actions');
                    const confirm = el('button', 'btn-confirmar', 'Confirmar');
                    confirm.type = 'button'; confirm.addEventListener('click', () => updateRegistration(eventId, item.id, 'Confirmed', title));
                    const cancel = el('button', 'btn-peligro', 'Cancelar inscripción');
                    cancel.type = 'button'; cancel.addEventListener('click', () => updateRegistration(eventId, item.id, 'Canceled', title));
                    actions.append(confirm, cancel); card.appendChild(actions);
                } else if (item.status === 'Confirmed') {
                    const cancel = el('button', 'btn-peligro', 'Cancelar inscripción');
                    cancel.type = 'button'; cancel.addEventListener('click', () => updateRegistration(eventId, item.id, 'Canceled', title));
                    card.appendChild(cancel);
                }
                registrationsList.appendChild(card);
            });
        } catch (_) { registrationsList.replaceChildren(el('p', 'evento-gestion-vacio', 'No se pudieron cargar las inscripciones.')); }
    }
    async function updateRegistration(eventId, registrationId, status, title) {
        try {
            await apiRequest(`/api/events/${eventId}/registrations/${registrationId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
            showToast(status === 'Confirmed' ? 'Inscripción confirmada.' : 'Inscripción cancelada.');
            await Promise.all([loadEventRegistrations(eventId, title), loadOrganizerEvents()]);
        } catch (error) {
            showToast(error.code === 'PAYMENT_REQUIRED' ? 'No se puede confirmar: falta verificar el pago.'
                : error.code === 'EVENT_FULL' ? 'No hay cupos disponibles para confirmar esta inscripción.'
                    : error.code === 'EVENT_CLOSED' ? 'No se pueden confirmar inscripciones de un evento cerrado.'
                    : 'No se pudo actualizar la inscripción.');
        }
    }

    // ---------- inscripciones de atletas ----------
    async function loadMyRegistrations() {
        myRegistrations.replaceChildren(el('p', 'evento-gestion-vacio', 'Cargando tus inscripciones…'));
        try {
            const items = await apiRequest('/api/events/registrations/mine');
            myRegistrations.replaceChildren();
            if (!items.length) myRegistrations.appendChild(el('p', 'evento-gestion-vacio', 'Aún no tienes inscripciones.'));
            items.forEach((item) => {
                const card = el('article', 'evento-inscripcion-card');
                card.appendChild(el('h3', null, item.title));
                card.appendChild(el('p', null, `${item.sport} · ${formatWhen(item.start_at, item.end_at)}`));
                card.appendChild(el('p', null, `${statusText(item.status)} · ${item.payment_status === 'Pending' ? 'Pago pendiente' : item.payment_status === 'NotRequired' ? 'Sin pago requerido' : item.payment_status}`));
                if (['Pending', 'Confirmed', 'Waitlisted'].includes(item.status) && item.event_status !== 'Completed') {
                    const cancel = el('button', 'btn-peligro', 'Cancelar inscripción');
                    cancel.type = 'button'; cancel.addEventListener('click', async () => {
                        try {
                            await apiRequest(`/api/events/${item.event_id}/registrations/mine`, { method: 'DELETE' });
                            showToast('Inscripción cancelada.');
                            await Promise.all([loadMyRegistrations(), load({ append: false })]);
                        } catch (_) { showToast('No se pudo cancelar la inscripción.'); }
                    });
                    card.appendChild(cancel);
                }
                myRegistrations.appendChild(card);
            });
        } catch (_) { myRegistrations.replaceChildren(el('p', 'evento-gestion-vacio', 'No pudimos cargar tus inscripciones.')); }
    }

    window.addEventListener('sportanet:auth-changed', syncAccountPanels);
    window.addEventListener('storage', (event) => {
        if (event.key === 'auth_token' || event.key === 'user') syncAccountPanels();
    });

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
    syncAccountPanels();
    load({ append: false });
})();
