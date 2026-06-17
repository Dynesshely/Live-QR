import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPersistedstate from 'pinia-plugin-persistedstate';
import { i18n } from './i18n';
import App from './App.vue';
import './style.css';

const app = createApp(App);

const pinia = createPinia();
pinia.use(piniaPersistedstate);
app.use(pinia);
app.use(i18n);

app.mount('#app');
