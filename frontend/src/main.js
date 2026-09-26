import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const targetEl = document.getElementById('app');
if (!targetEl) {
  throw new Error('Target element "#app" not found');
}

const app = mount(App, {
  target: targetEl,
})

export default app

