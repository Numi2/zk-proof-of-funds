import { useState, useMemo, useCallback } from 'react';
import {
  POLICY_TEMPLATES,
  TEMPLATE_CATEGORIES,
  COUNTRY_GROUPS,
  COUNTRY_GROUP_LABELS,
  type PolicyTemplate,
  type TemplateCategory,
  searchTemplates,
  getTemplatesByCategory,
} from '../config/zkpassport-templates';

interface Props {
  onSelect: (template: PolicyTemplate) => void;
  onClose: () => void;
}

export function ZKPassportTemplateSelector({ onSelect, onClose }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null);
  const [showCountryGroups, setShowCountryGroups] = useState(false);

  const filteredTemplates = useMemo(() => {
    let templates = selectedCategory === 'all' 
      ? POLICY_TEMPLATES 
      : getTemplatesByCategory(selectedCategory);
    
    if (searchQuery.trim()) {
      const searchResults = searchTemplates(searchQuery);
      templates = templates.filter(t => searchResults.some(r => r.id === t.id));
    }
    
    return templates;
  }, [selectedCategory, searchQuery]);

  const handleSelectTemplate = useCallback((template: PolicyTemplate) => {
    setSelectedTemplate(template);
  }, []);

  const handleConfirmSelection = useCallback(() => {
    if (selectedTemplate) {
      onSelect(selectedTemplate);
    }
  }, [selectedTemplate, onSelect]);

  const renderQuerySummary = (template: PolicyTemplate) => {
    const { query } = template;
    const parts: string[] = [];

    // Disclosure fields
    const disclosures = [];
    if (query.discloseFirstname) disclosures.push('First Name');
    if (query.discloseLastname) disclosures.push('Last Name');
    if (query.discloseFullname) disclosures.push('Full Name');
    if (query.discloseNationality) disclosures.push('Nationality');
    if (query.discloseBirthdate) disclosures.push('Birthdate');
    if (query.discloseExpiryDate) disclosures.push('Expiry Date');
    if (query.discloseDocumentNumber) disclosures.push('Document #');
    if (query.discloseDocumentType) disclosures.push('Document Type');
    if (query.discloseIssuingCountry) disclosures.push('Issuing Country');
    if (query.discloseGender) disclosures.push('Gender');
    
    if (disclosures.length > 0) {
      parts.push(`Discloses: ${disclosures.join(', ')}`);
    }

    // Age verification
    if (query.ageGte !== undefined) parts.push(`Age ≥ ${query.ageGte}`);
    if (query.ageLte !== undefined) parts.push(`Age ≤ ${query.ageLte}`);
    if (query.ageLt !== undefined) parts.push(`Age < ${query.ageLt}`);
    if (query.ageRange) parts.push(`Age: ${query.ageRange[0]}-${query.ageRange[1]}`);

    // Nationality checks
    if (query.nationalityIn?.length) {
      const count = query.nationalityIn.length;
      parts.push(`Nationality in: ${count} ${count === 1 ? 'country' : 'countries'}`);
    }
    if (query.nationalityOut?.length) {
      const count = query.nationalityOut.length;
      parts.push(`Nationality not in: ${count} ${count === 1 ? 'country' : 'countries'}`);
    }

    return parts;
  };

  return (
    <div className="template-selector-overlay" onClick={onClose}>
      <div className="template-selector-modal" onClick={e => e.stopPropagation()}>
        <header className="template-selector-header">
          <div className="template-selector-title">
            <h2>Choose a Policy Template</h2>
            <p className="muted small">
              Select a pre-built policy template or browse country groups
            </p>
          </div>
          <button className="template-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="template-selector-tabs">
          <button
            className={`template-tab ${!showCountryGroups ? 'active' : ''}`}
            onClick={() => setShowCountryGroups(false)}
          >
            📋 Policy Templates
          </button>
          <button
            className={`template-tab ${showCountryGroups ? 'active' : ''}`}
            onClick={() => setShowCountryGroups(true)}
          >
            🌍 Country Groups
          </button>
        </div>

        {!showCountryGroups ? (
          <>
            <div className="template-search-bar">
              <input
                type="search"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="template-search-input"
              />
            </div>

            <div className="template-category-pills">
              <button
                className={`category-pill ${selectedCategory === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('all')}
              >
                All
              </button>
              {(Object.entries(TEMPLATE_CATEGORIES) as [TemplateCategory, typeof TEMPLATE_CATEGORIES[TemplateCategory]][]).map(
                ([key, { label, icon }]) => (
                  <button
                    key={key}
                    className={`category-pill ${selectedCategory === key ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(key)}
                  >
                    {icon} {label}
                  </button>
                )
              )}
            </div>

            <div className="template-selector-body">
              <div className="template-list">
                {filteredTemplates.length === 0 ? (
                  <div className="template-empty">
                    <p className="muted">No templates found matching your criteria.</p>
                  </div>
                ) : (
                  filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      className={`template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
                      onClick={() => handleSelectTemplate(template)}
                    >
                      <div className="template-card-header">
                        <span className="template-icon">{template.icon}</span>
                        <div className="template-info">
                          <h4 className="template-name">{template.name}</h4>
                          <span className="template-category-badge">
                            {TEMPLATE_CATEGORIES[template.category].icon} {TEMPLATE_CATEGORIES[template.category].label}
                          </span>
                        </div>
                      </div>
                      <p className="template-description">{template.description}</p>
                      <div className="template-tags">
                        {template.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="template-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))
                )}
              </div>

              {selectedTemplate && (
                <div className="template-preview">
                  <div className="template-preview-header">
                    <span className="template-preview-icon">{selectedTemplate.icon}</span>
                    <h3>{selectedTemplate.name}</h3>
                  </div>
                  <p className="template-preview-description">{selectedTemplate.description}</p>
                  
                  <div className="template-preview-section">
                    <h4>Purpose</h4>
                    <p>{selectedTemplate.purpose}</p>
                  </div>

                  <div className="template-preview-section">
                    <h4>Verification Requirements</h4>
                    <ul className="template-requirements">
                      {renderQuerySummary(selectedTemplate).map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="template-preview-section">
                    <h4>Use Cases</h4>
                    <div className="template-use-cases">
                      {selectedTemplate.useCases.map((uc) => (
                        <span key={uc} className="use-case-badge">{uc}</span>
                      ))}
                    </div>
                  </div>

                  <button
                    className="template-use-btn"
                    onClick={handleConfirmSelection}
                  >
                    Use This Template
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="country-groups-container">
            <p className="muted small" style={{ marginBottom: '1.5rem' }}>
              Reference for country groups used in policy templates. Click to copy the country list.
            </p>
            <div className="country-groups-grid">
              {(Object.entries(COUNTRY_GROUP_LABELS) as [keyof typeof COUNTRY_GROUPS, string][]).map(
                ([key, label]) => {
                  const countries = COUNTRY_GROUPS[key];
                  return (
                    <button
                      key={key}
                      className="country-group-card"
                      onClick={() => {
                        navigator.clipboard.writeText(countries.join(', '));
                      }}
                    >
                      <div className="country-group-header">
                        <h4>{label}</h4>
                        <span className="country-count">{countries.length} countries</span>
                      </div>
                      <div className="country-group-preview">
                        {countries.slice(0, 6).join(', ')}
                        {countries.length > 6 && `, +${countries.length - 6} more`}
                      </div>
                      <span className="copy-hint">Click to copy</span>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

