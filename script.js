
/* --------------------------------------------------------------------------
   1. Configuration + state
   -------------------------------------------------------------------------- */

const TMDB_READ_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3YWM5NTViNTIyYWYxNWJkNDhhOTk5Zjc2MjVkNDI5MyIsIm5iZiI6MTc5MDQ5MjUxMS45ODMsInN1YiI6IjZhYjhiZjVmN2FmODQwOTFiNjY3ZGFhYiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.TXIcymhZpsDmx1wzvDAMxVywSF0G6VxmhASmkaGIO7U";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const RESULTS_PER_PAGE = 20;
const DEBOUNCE_DELAY_MS = 500;
const WATCHLIST_STORAGE_KEY = "cybermovies:watchlist";

const RECOMMENDATION_ENDPOINTS = {
  nowplaying: "/movie/now_playing",
  discover: "/discover/movie",
  popular: "/movie/popular",
  toprated: "/movie/top_rated",
};

const state = {
  query: "",
  currentPage: 1,
  totalResults: 0,
  isLoading: false,
  requestToken: 0,
  sortMode: "nowplaying",
  genreFilter: null,
  genres: [],
  genreMap: new Map(),
  discoverMovies: [],
};

const movieDetailCache = new Map();
const watchlist = new Map();
let modalRequestToken = 0;

/* --------------------------------------------------------------------------
   2. DOM references
   -------------------------------------------------------------------------- */

const navbar = document.getElementById("navbar");
const navbarMobileMenu = document.getElementById("navbar-mobile-menu");
const navMenuToggle = document.getElementById("nav-menu-toggle");
const navWatchlistButton = document.getElementById("nav-watchlist-button");
const watchlistCountBadge = document.getElementById("watchlist-count");

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchButton = document.getElementById("search-button");

const searchResultsSection = document.getElementById("search-results-section");
const searchResultsHeading = document.getElementById("search-results-heading");
const loadingIndicator = document.getElementById("loading-indicator");
const errorMessage = document.getElementById("error-message");
const emptyState = document.getElementById("empty-state");
const resultsMeta = document.getElementById("results-meta");
const resultsGrid = document.getElementById("results-grid");
const pagination = document.getElementById("pagination");
const prevPageButton = document.getElementById("prev-page-button");
const nextPageButton = document.getElementById("next-page-button");
const pageIndicator = document.getElementById("page-indicator");

const featuredSection = document.getElementById("featured-section");
const featuredLoading = document.getElementById("featured-loading");
const featuredCard = document.getElementById("featured-card");

const discoverSection = document.getElementById("discover-section");
const discoverLoading = document.getElementById("discover-loading");
const discoverEmpty = document.getElementById("discover-empty");
const discoverGrid = document.getElementById("discover-grid");
const sortTabsContainer = document.getElementById("sort-tabs");
const genreChipsContainer = document.getElementById("genre-chips");

const watchlistSection = document.getElementById("watchlist-section");
const watchlistEmpty = document.getElementById("watchlist-empty");
const watchlistGrid = document.getElementById("watchlist-grid");

const movieModal = document.getElementById("movie-modal");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalClose = document.getElementById("modal-close");
const modalBody = document.getElementById("modal-body");

/* --------------------------------------------------------------------------
   3. Utilities
   -------------------------------------------------------------------------- */

function debounce(fn, delayMs) {
  let timeoutId = null;

  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

function totalPages() {
  return Math.max(1, Math.ceil(state.totalResults / RESULTS_PER_PAGE));
}

function formatYear(dateString) {
  return dateString ? dateString.slice(0, 4) : "N/A";
}

function formatDate(dateString) {
  if (!dateString) return "Release date unavailable";
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateString
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function posterUrl(path) {
  return path ? `${TMDB_IMAGE_BASE_URL}${path}` : "";
}

function ratingBadgeMarkup(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `<span class="rating-badge"><span class="rating-badge__star">★</span>${value.toFixed(1)}</span>`;
}

function buildPlaceholderMarkup() {
  return `
    <div class="movie-card__poster--placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <circle cx="8.5" cy="9.5" r="1.5"></circle>
        <path d="M21 15l-5-5-9 9"></path>
      </svg>
      <span>No poster available</span>
    </div>
  `;
}

function normalizeMovie(item) {
  return {
    id: item.id,
    title: item.title || "Untitled movie",
    year: formatYear(item.release_date),
    releaseDate: item.release_date || "",
    poster: posterUrl(item.poster_path),
    backdrop: posterUrl(item.backdrop_path),
    rating: item.vote_average ?? 0,
    votes: item.vote_count ?? 0,
    plot: item.overview || "No plot summary available.",
    genreIds: Array.isArray(item.genre_ids) ? item.genre_ids : [],
    genre: Array.isArray(item.genres) ? item.genres.map((genre) => genre.name).join(", ") : "",
    runtime: item.runtime || 0,
    director: item.director || "",
  };
}

function genreNamesForMovie(movie) {
  if (movie.genre) return movie.genre;
  return movie.genreIds
    .map((id) => state.genreMap.get(id))
    .filter(Boolean)
    .join(", ");
}

/* --------------------------------------------------------------------------
   4. Watchlist
   -------------------------------------------------------------------------- */

function loadWatchlistFromStorage() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(items)) return;

    items.forEach((item) => {
      const id = item.id ?? item.tmdbID ?? item.imdbID;
      if (!id) return;

      watchlist.set(String(id), {
        id: Number.isFinite(Number(id)) ? Number(id) : id,
        title: item.title || "Untitled movie",
        year: item.year || "N/A",
        releaseDate: item.releaseDate || "",
        poster: item.poster || "",
        rating: item.rating ?? 0,
        plot: item.plot || "No plot summary available.",
        genreIds: item.genreIds || [],
        genre: item.genre || "",
      });
    });
  } catch (err) {
    console.warn("Couldn't read the watchlist from localStorage:", err);
  }
}

function saveWatchlistToStorage() {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([...watchlist.values()]));
  } catch (err) {
    console.warn("Couldn't save the watchlist to localStorage:", err);
  }
}

function isInWatchlist(movieId) {
  return watchlist.has(String(movieId));
}

function applyWatchlistState(element, isSaved) {
  if (element.classList.contains("watchlist-toggle")) {
    element.classList.toggle("is-active", isSaved);
    element.setAttribute("aria-pressed", String(isSaved));
    element.innerHTML = isSaved ? "&#9829;" : "&#9825;";
    element.setAttribute("aria-label", isSaved ? "Remove from watchlist" : "Add to watchlist");
  }

  if (element.classList.contains("watchlist-text-toggle")) {
    element.classList.toggle("is-active", isSaved);
    element.textContent = isSaved ? "In Watchlist" : "Add to Watchlist";
  }
}

function syncWatchlistControls(movieId) {
  const selectorId = CSS.escape(String(movieId));
  document
    .querySelectorAll(`[data-watchlist-id="${selectorId}"]`)
    .forEach((element) => applyWatchlistState(element, isInWatchlist(movieId)));
}

function updateWatchlistBadge() {
  const count = watchlist.size;
  watchlistCountBadge.textContent = String(count);
  watchlistCountBadge.hidden = count === 0;
}

function toggleWatchlistItem(movie) {
  if (!movie.id) return;

  const key = String(movie.id);

  if (watchlist.has(key)) {
    watchlist.delete(key);
  } else {
    watchlist.set(key, {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      releaseDate: movie.releaseDate,
      poster: movie.poster,
      rating: movie.rating,
      plot: movie.plot,
      genreIds: movie.genreIds || [],
      genre: genreNamesForMovie(movie),
    });
  }

  saveWatchlistToStorage();
  updateWatchlistBadge();
  syncWatchlistControls(movie.id);
  renderWatchlistGrid();
}

function renderWatchlistGrid() {
  const movies = [...watchlist.values()];
  watchlistGrid.replaceChildren();

  movies.forEach((movie) => watchlistGrid.appendChild(createMovieCard(movie)));

  watchlistGrid.hidden = movies.length === 0;
  watchlistEmpty.hidden = movies.length > 0;
  watchlistSection.hidden = false;
}

/* --------------------------------------------------------------------------
   5. Movie cards
   -------------------------------------------------------------------------- */

function createMovieCard(movie) {
  const card = document.createElement("li");
  card.className = "movie-card";

  const posterWrap = document.createElement("div");
  posterWrap.className = "movie-card__poster-wrap";
  posterWrap.style.cursor = "pointer";
  posterWrap.setAttribute("role", "button");
  posterWrap.setAttribute("tabindex", "0");
  posterWrap.setAttribute("aria-label", `View details for ${movie.title}`);
  posterWrap.addEventListener("click", () => openMovieModal(movie));
  posterWrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMovieModal(movie);
    }
  });

  const heartButton = document.createElement("button");
  heartButton.type = "button";
  heartButton.className = "watchlist-toggle";
  heartButton.dataset.watchlistId = String(movie.id);
  applyWatchlistState(heartButton, isInWatchlist(movie.id));
  heartButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleWatchlistItem(movie);
  });

  const hasPoster = Boolean(movie.poster);
  if (hasPoster) {
    const img = document.createElement("img");
    img.className = "movie-card__poster";
    img.src = movie.poster;
    img.alt = `Poster for ${movie.title}`;
    img.loading = "lazy";
    img.onerror = () => {
      img.onerror = null;
      posterWrap.innerHTML = "";
      posterWrap.insertAdjacentHTML("afterbegin", buildPlaceholderMarkup());
      posterWrap.appendChild(heartButton);
    };
    posterWrap.appendChild(img);
  } else {
    posterWrap.insertAdjacentHTML("afterbegin", buildPlaceholderMarkup());
  }
  posterWrap.appendChild(heartButton);

  const body = document.createElement("div");
  body.className = "movie-card__body";

  const title = document.createElement("h3");
  title.className = "movie-card__title";
  title.textContent = movie.title;
  title.tabIndex = 0;
  title.setAttribute("role", "button");
  title.setAttribute("aria-label", `View details for ${movie.title}`);
  title.addEventListener("click", () => openMovieModal(movie));
  title.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMovieModal(movie);
    }
  });

  const meta = document.createElement("div");
  meta.className = "movie-card__meta";
  meta.innerHTML = `<span>${escapeHtml(movie.year)}</span>${ratingBadgeMarkup(movie.rating)}`;

  const plot = document.createElement("p");
  plot.className = "movie-card__plot";
  plot.textContent = movie.plot || "No plot summary available.";

  const genre = genreNamesForMovie(movie);
  if (genre) {
    const genreText = document.createElement("p");
    genreText.className = "movie-card__genre";
    genreText.textContent = genre.split(",")[0].trim();
    body.appendChild(genreText);
  }

  body.append(title, meta, plot);
  card.append(posterWrap, body);

  return card;
}

/* --------------------------------------------------------------------------
   6. Details modal
   -------------------------------------------------------------------------- */

function renderModal(movie, isLoading = false) {
  const genre = genreNamesForMovie(movie);
  const hasPoster = Boolean(movie.poster);
  const isSaved = isInWatchlist(movie.id);

  modalBody.innerHTML = `
    <div class="modal__top">
      ${hasPoster ? `<img class="modal__poster" src="${escapeHtml(movie.poster)}" alt="Poster for ${escapeHtml(movie.title)}" />` : `<div class="modal__poster modal__poster--placeholder">No poster</div>`}
      <div class="modal__summary">
        <p class="section-kicker">MOVIE DETAILS</p>
        <h3 id="modal-title" class="modal__title">${escapeHtml(movie.title)}</h3>
        <div class="modal__meta">
          <span>${escapeHtml(movie.year)}</span>
          ${ratingBadgeMarkup(movie.rating)}
          ${genre ? `<span>${escapeHtml(genre)}</span>` : ""}
        </div>
        <p class="modal__plot">${escapeHtml(movie.plot || "No plot summary available.")}</p>
        ${movie.releaseDate ? `<p class="modal__detail"><strong>Release:</strong> ${escapeHtml(formatDate(movie.releaseDate))}</p>` : ""}
        ${movie.runtime ? `<p class="modal__detail"><strong>Runtime:</strong> ${escapeHtml(String(movie.runtime))} min</p>` : ""}
        ${movie.director ? `<p class="modal__detail"><strong>Director:</strong> ${escapeHtml(movie.director)}</p>` : ""}
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost watchlist-text-toggle" data-watchlist-id="${escapeHtml(movie.id)}">
            ${isSaved ? "In Watchlist" : "Add to Watchlist"}
          </button>
        </div>
        ${isLoading ? `<p class="modal__loading"><span class="spinner" aria-hidden="true"></span> Loading full details&hellip;</p>` : ""}
      </div>
    </div>
  `;

  const watchlistButton = modalBody.querySelector(".watchlist-text-toggle");
  if (watchlistButton) {
    watchlistButton.addEventListener("click", () => toggleWatchlistItem(movie));
  }
}

async function openMovieModal(movie) {
  const token = ++modalRequestToken;
  movieModal.hidden = false;
  renderModal(movie, true);
  modalClose.focus();

  if (movieDetailCache.has(movie.id)) {
    const detailedMovie = { ...movie, ...movieDetailCache.get(movie.id) };
    if (token === modalRequestToken) renderModal(detailedMovie);
    return;
  }

  try {
    const details = await fetchMovieDetails(movie.id);
    if (token !== modalRequestToken) return;

    const detailedMovie = { ...movie, ...details };
    movieDetailCache.set(movie.id, details);
    renderModal(detailedMovie);
  } catch (err) {
    if (token === modalRequestToken) renderModal(movie);
    console.warn("Couldn't load full movie details:", err);
  }
}

function closeMovieModal() {
  modalRequestToken += 1;
  movieModal.hidden = true;
  modalBody.replaceChildren();
}

/* --------------------------------------------------------------------------
   7. TMDB API access
   -------------------------------------------------------------------------- */

function validateToken() {
  if (!TMDB_READ_ACCESS_TOKEN || TMDB_READ_ACCESS_TOKEN.includes("YOUR_TMDB")) {
    throw new Error("Add your TMDB Read Access Token at the top of script.js before running CyberMovies.");
  }
}

async function tmdbFetch(path, params = {}) {
  validateToken();

  const url = new URL(`${TMDB_BASE_URL}${path}`);
  Object.entries({ language: "en-US", ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${TMDB_READ_ACCESS_TOKEN}`,
      },
    });
  } catch (networkError) {
    throw new Error("Couldn't reach TMDB. Check your internet connection and try again.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("TMDB returned a response we couldn't understand.");
  }

  if (!response.ok) {
    throw new Error(data?.status_message || `TMDB returned an error (status ${response.status}).`);
  }

  return data;
}

async function fetchGenres() {
  if (state.genreMap.size > 0) return;

  const data = await tmdbFetch("/genre/movie/list");
  state.genres = Array.isArray(data.genres) ? data.genres : [];
  state.genreMap = new Map(state.genres.map((genre) => [genre.id, genre.name]));
}

function buildMovieList(data) {
  if (!Array.isArray(data.results)) return [];
  return data.results
    .filter((item) => item && item.id && item.title)
    .map(normalizeMovie);
}

async function fetchMovieDetails(movieId) {
  const data = await tmdbFetch(`/movie/${encodeURIComponent(movieId)}`, {
    append_to_response: "credits",
  });

  const director = Array.isArray(data.credits?.crew)
    ? data.credits.crew.find((person) => person.job === "Director")?.name || ""
    : "";

  return {
    releaseDate: data.release_date || "",
    year: formatYear(data.release_date),
    poster: posterUrl(data.poster_path),
    backdrop: posterUrl(data.backdrop_path),
    rating: data.vote_average ?? 0,
    votes: data.vote_count ?? 0,
    plot: data.overview || "No plot summary available.",
    genreIds: Array.isArray(data.genres) ? data.genres.map((genre) => genre.id) : [],
    genre: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).join(", ") : "",
    runtime: data.runtime || 0,
    director,
  };
}

async function fetchSearchResults(query, page) {
  const data = await tmdbFetch("/search/movie", {
    query,
    page,
    include_adult: false,
  });

  state.totalResults = Number(data.total_results) || 0;
  return buildMovieList(data);
}

async function fetchRecommendationMode(mode) {
  const endpoint = RECOMMENDATION_ENDPOINTS[mode] || RECOMMENDATION_ENDPOINTS.nowplaying;

  let params = {
    page: 1,
    include_adult: false,
    include_video: false,
  };

  if (mode === "discover") {
    params.sort_by = "popularity.desc";
  }

  if (state.genreFilter) {
    params.with_genres = state.genreFilter;
  }

  const data = await tmdbFetch(endpoint, params);
  return buildMovieList(data);
}

/* --------------------------------------------------------------------------
   8. Dynamic recommendations
   -------------------------------------------------------------------------- */

function renderFeatured(movie) {
  const hasBackdrop = Boolean(movie.backdrop || movie.poster);
  const background = movie.backdrop || movie.poster;
  const genre = genreNamesForMovie(movie);
  const isSaved = isInWatchlist(movie.id);

  featuredCard.hidden = false;
  featuredCard.className = `featured-card${hasBackdrop ? "" : " featured-card--no-image"}`;
  featuredCard.style.backgroundImage = hasBackdrop ? `url("${background.replaceAll('"', '\\"')}")` : "";

  featuredCard.innerHTML = `
    <div class="featured-card__content">
      <p class="featured-card__eyebrow">Now Playing Pick</p>
      <h3 class="featured-card__title">${escapeHtml(movie.title)}</h3>
      <div class="featured-card__meta">
        <span>${escapeHtml(movie.year)}</span>
        ${ratingBadgeMarkup(movie.rating)}
        ${genre ? `<span class="featured-card__genre">${escapeHtml(genre.split(",")[0].trim())}</span>` : ""}
      </div>
      <p class="featured-card__plot">${escapeHtml(movie.plot)}</p>
      <div class="featured-card__actions">
        <button type="button" class="btn btn--primary" id="featured-details-button">View Details</button>
        <button type="button" class="btn btn--ghost watchlist-text-toggle" data-watchlist-id="${escapeHtml(movie.id)}">
          ${isSaved ? "In Watchlist" : "Add to Watchlist"}
        </button>
      </div>
    </div>
  `;

  featuredCard.querySelector("#featured-details-button").addEventListener("click", () => openMovieModal(movie));
  featuredCard.querySelector(".watchlist-text-toggle").addEventListener("click", () => toggleWatchlistItem(movie));
}

function buildGenreChips() {
  const genres = state.genres;
  if (genres.length === 0) {
    genreChipsContainer.hidden = true;
    return;
  }

  genreChipsContainer.replaceChildren();

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = `genre-chip${state.genreFilter === null ? " is-active" : ""}`;
  allChip.textContent = "All";
  allChip.addEventListener("click", () => {
    state.genreFilter = null;
    state.sortMode = "nowplaying";
    updateSortTabs("nowplaying");
    loadDiscovery();
  });
  genreChipsContainer.appendChild(allChip);

  genres.forEach((genre) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `genre-chip${state.genreFilter === genre.id ? " is-active" : ""}`;
    chip.textContent = genre.name;
    chip.addEventListener("click", () => {
      state.genreFilter = genre.id;
      state.sortMode = "discover";
      updateSortTabs("discover");
      loadDiscovery();
    });
    genreChipsContainer.appendChild(chip);
  });

  genreChipsContainer.hidden = false;
}

function updateSortTabs(mode) {
  sortTabsContainer.querySelectorAll(".sort-tab").forEach((tab) => {
    const isActive = tab.dataset.sort === mode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
}

async function loadDiscovery() {
  discoverSection.hidden = false;
  featuredSection.hidden = false;
  featuredLoading.hidden = true;
  discoverLoading.hidden = false;
  discoverEmpty.hidden = true;
  discoverGrid.hidden = true;

  try {
    await fetchGenres();
    buildGenreChips();

    const movies = await fetchRecommendationMode(state.sortMode);
    state.discoverMovies = movies;

    if (movies.length === 0) {
      featuredSection.hidden = true;
      discoverEmpty.textContent = "No movies were returned for this selection.";
      discoverEmpty.hidden = false;
      return;
    }

    const featuredSource = state.sortMode === "nowplaying" ? movies : movies.slice(0, 1);
    renderFeatured(featuredSource[0]);

    discoverGrid.replaceChildren();
    movies.slice(1).forEach((movie) => discoverGrid.appendChild(createMovieCard(movie)));
    discoverGrid.hidden = movies.length <= 1;
  } catch (err) {
    featuredSection.hidden = true;
    discoverGrid.hidden = true;
    discoverEmpty.textContent = err.message || "Couldn't load recommendations right now.";
    discoverEmpty.hidden = false;
  } finally {
    discoverLoading.hidden = true;
  }
}

function setSortMode(mode) {
  state.sortMode = mode;
  if (mode !== "discover" && state.genreFilter !== null) {
    state.genreFilter = null;
  }
  updateSortTabs(mode);
  loadDiscovery();
}

/* --------------------------------------------------------------------------
   9. Search
   -------------------------------------------------------------------------- */

function showLoading(isLoading) {
  state.isLoading = isLoading;
  loadingIndicator.hidden = !isLoading;
  searchButton.disabled = isLoading;
  prevPageButton.disabled = isLoading || state.currentPage <= 1;
  nextPageButton.disabled = isLoading || state.currentPage >= totalPages();
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function showEmptyState(message) {
  emptyState.textContent = message;
  emptyState.hidden = !message;
}

function clearResultsUI() {
  resultsGrid.replaceChildren();
  resultsGrid.hidden = true;
  resultsMeta.hidden = true;
  pagination.hidden = true;
}

function renderResults(movies) {
  resultsGrid.replaceChildren();
  movies.forEach((movie) => resultsGrid.appendChild(createMovieCard(movie)));
  resultsGrid.hidden = movies.length === 0;

  resultsMeta.textContent = `${state.totalResults.toLocaleString()} result${state.totalResults === 1 ? "" : "s"} for "${state.query}"`;
  resultsMeta.hidden = false;
}

function renderPagination() {
  const pages = totalPages();
  pagination.hidden = state.totalResults === 0;
  pageIndicator.textContent = `Page ${state.currentPage} of ${pages}`;
  prevPageButton.disabled = state.currentPage <= 1 || state.isLoading;
  nextPageButton.disabled = state.currentPage >= pages || state.isLoading;
}

async function runSearch(query, page = 1) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    state.requestToken += 1;
    state.query = "";
    searchResultsSection.hidden = true;
    showError("");
    showEmptyState("");
    clearResultsUI();
    showLoading(false);
    return;
  }

  state.query = trimmedQuery;
  state.currentPage = page;
  searchResultsSection.hidden = false;
  searchResultsHeading.textContent = `Search results for "${trimmedQuery}"`;
  showError("");
  showEmptyState("");

  const myToken = ++state.requestToken;
  showLoading(true);
  clearResultsUI();

  try {
    const movies = await fetchSearchResults(trimmedQuery, page);
    if (myToken !== state.requestToken) return;

    if (movies.length === 0) {
      showEmptyState(`No movies found for "${trimmedQuery}". Try another title.`);
      renderPagination();
      return;
    }

    renderResults(movies);
    renderPagination();
  } catch (err) {
    if (myToken !== state.requestToken) return;
    showError(err.message || "Something went wrong while fetching movies.");
  } finally {
    if (myToken === state.requestToken) showLoading(false);
  }
}

/* --------------------------------------------------------------------------
   10. Navbar + event wiring
   -------------------------------------------------------------------------- */

function handleWindowScroll() {
  navbar.classList.toggle("is-scrolled", window.scrollY > 8);
}

function openMobileMenu() {
  navbarMobileMenu.hidden = false;
  navMenuToggle.setAttribute("aria-expanded", "true");
}

function closeMobileMenu() {
  navbarMobileMenu.hidden = true;
  navMenuToggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  if (navbarMobileMenu.hidden) openMobileMenu();
  else closeMobileMenu();
}

function handleSearchSubmit(event) {
  event.preventDefault();
  runSearch(searchInput.value, 1);
}

const debouncedAutoSearch = debounce(() => {
  runSearch(searchInput.value, 1);
}, DEBOUNCE_DELAY_MS);

function handleSearchInput() {
  const value = searchInput.value.trim();

  if (value.length === 0) {
    runSearch("", 1);
    return;
  }

  if (value.length >= 2) debouncedAutoSearch();
}

function handlePrevPage() {
  if (state.currentPage <= 1 || state.isLoading) return;
  runSearch(state.query, state.currentPage - 1);
}

function handleNextPage() {
  if (state.currentPage >= totalPages() || state.isLoading) return;
  runSearch(state.query, state.currentPage + 1);
}

function init() {
  loadWatchlistFromStorage();
  updateWatchlistBadge();
  renderWatchlistGrid();

  searchForm.addEventListener("submit", handleSearchSubmit);
  searchInput.addEventListener("input", handleSearchInput);
  prevPageButton.addEventListener("click", handlePrevPage);
  nextPageButton.addEventListener("click", handleNextPage);

  sortTabsContainer.querySelectorAll(".sort-tab").forEach((tab) => {
    tab.addEventListener("click", () => setSortMode(tab.dataset.sort));
  });

  document.querySelectorAll(".navbar__link--button, .navbar__mobile-link--button").forEach((button) => {
    button.addEventListener("click", () => {
      setSortMode(button.dataset.sort);
      document.getElementById("discover-section").scrollIntoView({ behavior: "smooth" });
      closeMobileMenu();
    });
  });

  document.querySelectorAll(".navbar__mobile-link:not(.navbar__mobile-link--button)").forEach((link) => {
    link.addEventListener("click", closeMobileMenu);
  });

  navWatchlistButton.addEventListener("click", () => {
    watchlistSection.scrollIntoView({ behavior: "smooth" });
    closeMobileMenu();
  });

  navMenuToggle.addEventListener("click", toggleMobileMenu);
  window.addEventListener("scroll", handleWindowScroll, { passive: true });

  modalClose.addEventListener("click", closeMovieModal);
  modalBackdrop.addEventListener("click", closeMovieModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!movieModal.hidden) closeMovieModal();
      else if (!navbarMobileMenu.hidden) closeMobileMenu();
    }
  });

  loadDiscovery();
}

init();
