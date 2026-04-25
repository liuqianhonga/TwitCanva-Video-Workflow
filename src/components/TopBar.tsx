import React, { useState } from 'react';
import { Plus, Save, Loader2, HelpCircle, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface TopBarProps {
    canvasTitle: string;
    isEditingTitle: boolean;
    editingTitleValue: string;
    canvasTitleInputRef: React.RefObject<HTMLInputElement>;
    setCanvasTitle: (title: string) => void;
    setIsEditingTitle: (editing: boolean) => void;
    setEditingTitleValue: (value: string) => void;
    onSave: () => void | Promise<void>;
    onNew: () => void;
    hasUnsavedChanges: boolean;
    lastAutoSaveTime?: number;
    isChatOpen?: boolean;
    canvasTheme: 'dark' | 'light';
    onToggleTheme: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    canvasTitle,
    isEditingTitle,
    editingTitleValue,
    canvasTitleInputRef,
    setCanvasTitle,
    setIsEditingTitle,
    setEditingTitleValue,
    onSave,
    onNew,
    hasUnsavedChanges,
    lastAutoSaveTime,
    isChatOpen = false,
    canvasTheme,
    onToggleTheme
}) => {
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const { locale, setLocale, t, formatTime } = useI18n();

    const handleTitleBlur = () => {
        if (editingTitleValue.trim()) {
            setCanvasTitle(editingTitleValue.trim());
        } else {
            setEditingTitleValue(canvasTitle);
        }
        setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (editingTitleValue.trim()) {
                setCanvasTitle(editingTitleValue.trim());
            }
            setIsEditingTitle(false);
        } else if (e.key === 'Escape') {
            setEditingTitleValue(canvasTitle);
            setIsEditingTitle(false);
        }
    };

    const handleTitleDoubleClick = () => {
        setEditingTitleValue(canvasTitle);
        setIsEditingTitle(true);
    };

    const handleNewClick = () => {
        if (hasUnsavedChanges) {
            setShowNewConfirm(true);
        } else {
            onNew();
        }
    };

    const handleSaveAndNew = async () => {
        try {
            setIsSaving(true);
            await onSave();
            setShowNewConfirm(false);
            onNew();
        } catch (error) {
            console.error("Failed to save and new:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscardAndNew = () => {
        setShowNewConfirm(false);
        onNew();
    };

    const toggleLocale = () => {
        setLocale(locale === 'en' ? 'zh-CN' : 'en');
    };

    return (
        <>
            <div
                className="fixed top-0 left-0 h-14 flex items-center justify-between px-6 z-50 pointer-events-none transition-all duration-300"
                style={{ width: isChatOpen ? 'calc(100% - 400px)' : '100%' }}
            >
                <div className="flex items-center gap-3 pointer-events-auto">
                    <img src="/TwitCanva-logo.png" alt="TwitCanva Logo" className="w-8 h-8 rounded-lg object-contain bg-black/20" />
                    {isEditingTitle ? (
                        <input
                            ref={canvasTitleInputRef as React.RefObject<HTMLInputElement>}
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            className="font-semibold text-neutral-300 bg-transparent border-b border-blue-500 outline-none min-w-[100px]"
                        />
                    ) : (
                        <span
                            className={`font-semibold cursor-pointer transition-colors ${canvasTheme === 'dark' ? 'text-neutral-300 hover:text-white' : 'text-neutral-900 hover:text-neutral-600'}`}
                            onDoubleClick={handleTitleDoubleClick}
                            title={t('topbar.renameHint')}
                        >
                            {canvasTitle}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3 pointer-events-auto">
                    {lastAutoSaveTime && !hasUnsavedChanges && (
                        <div className={`text-[10px] font-medium px-2 py-1 rounded border animate-in fade-in duration-500 ${canvasTheme === 'dark'
                            ? 'text-neutral-500 border-neutral-800'
                            : 'text-neutral-400 border-neutral-100'
                            }`}>
                            {t('topbar.autoSaved', { time: formatTime(lastAutoSaveTime) })}
                        </div>
                    )}
                    <button
                        onClick={() => onSave()}
                        className={`text-sm px-5 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300 shadow-sm'
                            }`}
                    >
                        <Save size={16} />
                        {t('topbar.save')}
                    </button>
                    <button
                        onClick={handleNewClick}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-900 border-neutral-300'
                            }`}
                    >
                        <Plus size={16} />
                        {t('topbar.new')}
                    </button>
                    <button
                        onClick={() => setIsHelpOpen(true)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${canvasTheme === 'dark'
                            ? 'bg-neutral-900 border-neutral-700 text-cyan-300 hover:bg-neutral-800'
                            : 'bg-white border-neutral-200 text-cyan-600 hover:bg-neutral-50 shadow-sm'
                            }`}
                        title={t('topbar.help')}
                    >
                        <HelpCircle size={18} />
                    </button>
                    <button
                        onClick={toggleLocale}
                        className={`px-3 h-10 rounded-full flex items-center justify-center transition-colors border text-xs font-semibold ${canvasTheme === 'dark'
                            ? 'bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800'
                            : 'bg-white border-neutral-200 text-neutral-800 hover:bg-neutral-50 shadow-sm'
                            }`}
                        title={locale === 'en' ? t('topbar.switchToChinese') : t('topbar.switchToEnglish')}
                    >
                        {locale === 'en' ? '中文' : 'EN'}
                    </button>
                    <button
                        onClick={onToggleTheme}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${canvasTheme === 'dark'
                            ? 'bg-neutral-900 border-neutral-700 text-yellow-400 hover:bg-neutral-800'
                            : 'bg-white border-neutral-200 text-orange-500 hover:bg-neutral-50 shadow-sm'
                            }`}
                        title={canvasTheme === 'dark' ? t('topbar.switchToDay') : t('topbar.switchToNight')}
                    >
                        {canvasTheme === 'dark' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                        )}
                    </button>
                </div>
            </div>

            {isHelpOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110]">
                    <div className={`w-[620px] max-w-[92vw] rounded-2xl border shadow-2xl p-6 ${canvasTheme === 'dark' ? 'bg-[#141414] border-neutral-700' : 'bg-white border-neutral-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className={`text-lg font-semibold ${canvasTheme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
                                {t('topbar.helpTitle')}
                            </h3>
                            <button
                                onClick={() => setIsHelpOpen(false)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${canvasTheme === 'dark' ? 'hover:bg-neutral-800 text-neutral-300' : 'hover:bg-neutral-100 text-neutral-600'}`}
                                title={t('topbar.close')}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
                            <div>
                                <div className={`font-medium mb-2 ${canvasTheme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('topbar.canvasOperations')}</div>
                                <ul className={`space-y-1.5 ${canvasTheme === 'dark' ? 'text-neutral-300' : 'text-neutral-600'}`}>
                                    <li>{t('topbar.help.panCanvas')}</li>
                                    <li>{t('topbar.help.wheelPan')}</li>
                                    <li>{t('topbar.help.zoom')}</li>
                                    <li>{t('topbar.help.boxSelect')}</li>
                                </ul>
                            </div>

                            <div>
                                <div className={`font-medium mb-2 ${canvasTheme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('topbar.shortcuts')}</div>
                                <ul className={`space-y-1.5 ${canvasTheme === 'dark' ? 'text-neutral-300' : 'text-neutral-600'}`}>
                                    <li>{t('topbar.help.undo')}</li>
                                    <li>{t('topbar.help.redo')}</li>
                                    <li>{t('topbar.help.copy')}</li>
                                    <li>{t('topbar.help.paste')}</li>
                                    <li>{t('topbar.help.delete')}</li>
                                    <li>{t('topbar.help.deselect')}</li>
                                </ul>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setIsHelpOpen(false)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${canvasTheme === 'dark' ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300'}`}
                            >
                                {t('topbar.close')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showNewConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[400px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-2">{t('topbar.unsavedTitle')}</h3>
                        <p className="text-neutral-400 text-sm mb-6">
                            {t('topbar.unsavedBody')}
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowNewConfirm(false)}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('topbar.cancel')}
                            </button>
                            <button
                                onClick={handleDiscardAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('topbar.discard')}
                            </button>
                            <button
                                onClick={handleSaveAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t('topbar.saving')}
                                    </>
                                ) : (
                                    t('topbar.saveAndNew')
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
