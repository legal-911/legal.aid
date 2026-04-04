async function renderArticles() {
  articlesDiv.innerHTML = "";
  const query = searchInput.value.trim().toLowerCase();

  // ===== ГОЛОВНА СТОРІНКА =====
  if (currentSection === null) {
    if (!query) {
      lawSections.forEach(section => {
        const div = document.createElement("div");
        div.className = "section-header";

        div.innerHTML = `
          <h2>${escapeHtml(section)}</h2>
          <p>Перейти до статей розділу</p>
        `;

        const openBtn = document.createElement("button");
        openBtn.textContent = "Відкрити";
        openBtn.onclick = () => {
          currentSection = section;
          renderArticles();
        };

        div.appendChild(openBtn);
        articlesDiv.appendChild(div);
      });
      return;
    }

    articlesDiv.innerHTML = `
      <div class="section-header">
        <h2>Пошук...</h2>
        <p>Шукаю по всіх законах</p>
      </div>
    `;

    const prefilteredArticles = articles.map((a, index) => ({
      ...a,
      originalIndex: index
    }));

    const filteredGlobalArticles = await rankArticlesWithAI(query, prefilteredArticles);

    articlesDiv.innerHTML = "";

    if (filteredGlobalArticles.length === 0) {
      articlesDiv.innerHTML = `
        <div class="section-header">
          <h2>Нічого не знайдено</h2>
          <p>Спробуйте інше ключове слово</p>
        </div>
      `;
      return;
    }

    filteredGlobalArticles.forEach((a) => {
      const index = a.originalIndex;
      const div = document.createElement("div");
      div.className = "article";

      div.innerHTML = `
        <h2>${escapeHtml(a.law)}</h2>
        <p><b>${escapeHtml(a.section || "Без назви закону")}</b></p>
        <p>${escapeHtml(a.short || "")}</p>
      `;

      const detailsDiv = document.createElement("div");
      detailsDiv.className = "details";

      detailsDiv.innerHTML = `
        <div style="line-height:1.6;">
          ${formatText(a.details)}
          ${a.link ? `<a href="${a.link}" target="_blank" style="display:block; margin-top:10px; color:#004080;">Посилання</a>` : ""}
        </div>
      `;

      div.appendChild(detailsDiv);

      const moreBtn = document.createElement("button");
      moreBtn.textContent = "Докладніше";
      moreBtn.onclick = () => {
        detailsDiv.style.display = detailsDiv.style.display === "block" ? "none" : "block";
      };
      div.appendChild(moreBtn);

      const openLawBtn = document.createElement("button");
      openLawBtn.textContent = "Відкрити закон";
      openLawBtn.onclick = () => {
        currentSection = a.section;
        renderArticles();
      };
      div.appendChild(openLawBtn);

      if (isAdmin) {
        const editBtn = document.createElement("button");
        editBtn.textContent = "Редагувати";
        editBtn.onclick = () => openEditModal(index);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Видалити";
        delBtn.onclick = () => openDeleteModal(index);

        div.appendChild(editBtn);
        div.appendChild(delBtn);
      }

      articlesDiv.appendChild(div);
    });

    return;
  }

  // ===== СТОРІНКА КОНКРЕТНОГО ЗАКОНУ =====
  const backDiv = document.createElement("div");
  backDiv.className = "section-header";
  backDiv.innerHTML = `<h2>${escapeHtml(currentSection)}</h2><p>Список статей розділу</p>`;

  const backBtn = document.createElement("button");
  backBtn.textContent = "Назад до розділів";
  backBtn.onclick = () => {
    currentSection = null;
    renderArticles();
  };

  backDiv.appendChild(backBtn);
  articlesDiv.appendChild(backDiv);

  let filteredArticles = articles
    .map((a, index) => ({ ...a, originalIndex: index }))
    .filter(a => a.section === currentSection);

  if (query) {
    filteredArticles = fallbackRankArticles(query, filteredArticles);
  } else {
    filteredArticles = filteredArticles.sort((a, b) => getArticleNumber(a.law) - getArticleNumber(b.law));
  }

  filteredArticles.forEach((a) => {
    const index = a.originalIndex;
    const div = document.createElement("div");
    div.className = "article";

    div.innerHTML = `<h2>${escapeHtml(a.law)}</h2><p>${escapeHtml(a.short || "")}</p>`;

    const detailsDiv = document.createElement("div");
    detailsDiv.className = "details";
    detailsDiv.innerHTML = `
      <div style="line-height:1.6; white-space:pre-line;">
        ${formatText(a.details)}
        ${a.link ? `<a href="${a.link}" target="_blank" style="display:block; margin-top:10px; color:#004080; font-weight:500;">Посилання на статтю</a>` : ""}
      </div>
    `;

    div.appendChild(detailsDiv);

    const moreBtn = document.createElement("button");
    moreBtn.textContent = "Докладніше";
    moreBtn.onclick = () => {
      detailsDiv.style.display = detailsDiv.style.display === "block" ? "none" : "block";
    };
    div.appendChild(moreBtn);

    if (isAdmin) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Редагувати";
      editBtn.onclick = () => openEditModal(index);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Видалити";
      delBtn.onclick = () => openDeleteModal(index);

      div.appendChild(editBtn);
      div.appendChild(delBtn);
    }

    articlesDiv.appendChild(div);
  });
}
