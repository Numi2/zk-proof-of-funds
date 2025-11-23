import { Route, Routes } from 'react-router-dom';
import './App.css';
import { ZKPFApp } from './components/ZKPFApp';
import { ZKPassportApp } from './components/ZKPassportApp';

function App() {
  return (
    <Routes>
      <Route
        path="/zkpassport/*"
        element={<ZKPassportApp />}
      />
      <Route
        path="/*"
        element={<ZKPFApp />}
      />
    </Routes>
  );
}

export default App;
