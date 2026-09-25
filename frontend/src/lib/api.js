
import env from '../config/env.js';

const headers = {}


/**
 * @param {string} path
 */
export async function apiFetch(path, options = {headers : headers}) {
  const controller = new AbortController();
    
  const timeout = setTimeout(() => {
    controller.abort(); 
  }, env.apiTimeoutMs)
  
  try {
      
    const response = await fetch(`${env.apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    return response;
  }finally{
    clearTimeout(timeout)
  }
}