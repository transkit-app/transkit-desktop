import { Navigate } from 'react-router-dom';

import Translate from '../pages/Translate';
import Recognize from '../pages/Recognize';
import General from '../pages/General';
import Service from '../pages/Service';
import History from '../pages/History';
import Hotkey from '../pages/Hotkey';
import Backup from '../pages/Backup';
import About from '../pages/About';
import AudioTranslate from '../pages/AudioTranslate';
import VoiceInput from '../pages/VoiceInput';
import Profile from '../pages/Profile';
import Account from '../pages/Account';

const routes = [
    {
        path: '/general',
        element: <General />,
    },
    {
        path: '/translate',
        element: <Translate />,
    },
    {
        path: '/recognize',
        element: <Recognize />,
    },
    {
        path: '/audio-translate',
        element: <AudioTranslate />,
    },
    {
        path: '/voice-input',
        element: <VoiceInput />,
    },
    {
        path: '/profile',
        element: <Profile />,
    },
    {
        path: '/hotkey',
        element: <Hotkey />,
    },
    {
        path: '/service',
        element: <Service />,
    },
    {
        path: '/history',
        element: <History />,
    },
    {
        path: '/backup',
        element: <Backup />,
    },
    {
        path: '/about',
        element: <About />,
    },
    {
        path: '/account',
        element: <Account />,
    },
    {
        path: '/',
        element: <Navigate to='/general' />,
    },
];

export default routes;
