import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { LangProvider } from './i18n/LangProvider';
import { routes } from './routes';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/tokens.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 요소가 없습니다.');

const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <LangProvider>
      <RouterProvider router={router} />
    </LangProvider>
  </StrictMode>,
);
