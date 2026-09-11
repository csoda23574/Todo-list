try {
    const savedTheme = JSON.parse(localStorage.getItem('todoApp_theme') || '"light"');
    document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
} catch { }
