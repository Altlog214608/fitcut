import type { RouteObject } from 'react-router';
import { Layout } from './Layout';
import { AdminPage } from './pages/AdminPage';
import { AudioPage } from './pages/AudioPage';
import { GifPage } from './pages/GifPage';
import { HighlightPage } from './pages/HighlightPage';
import { HomePage } from './pages/HomePage';
import { LinkPage } from './pages/LinkPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PhotoPage } from './pages/PhotoPage';
import { RotatePage } from './pages/RotatePage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'photo', element: <PhotoPage /> },
      { path: 'gif', element: <GifPage /> },
      { path: 'audio', element: <AudioPage /> },
      { path: 'rotate', element: <RotatePage /> },
      { path: 'link', element: <LinkPage /> },
      { path: 'highlight', element: <HighlightPage /> },
      // 관리자 API는 Cognito 관리자 그룹 + MFA로 보호한다 (M4). 이 화면 자체는 보호 수단이 아니다.
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
